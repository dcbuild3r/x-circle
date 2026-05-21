#!/usr/bin/env python3
"""Build an X Circle network JSON from an X/Twitter archive export.

Default input:
  ~/Documents/exports/X/data

Default output:
  public/generated/x-network.json

The script reads the official archive JavaScript files, computes interaction
scores, and emits the browser-ready shape consumed by the React app. It does
not upload data anywhere.
"""

from __future__ import annotations

import argparse
import json
import re
import time
from collections import Counter, defaultdict
from pathlib import Path


def load_js(path: Path):
    text = path.read_text(encoding="utf-8")
    match = re.match(r"\s*window\.YTD\.[^=]+=\s*", text)
    if match:
        text = text[match.end():]
    return json.loads(text)


def safe_load_js(root: Path, name: str):
    path = root / name
    if not path.exists():
        return []
    try:
        return load_js(path)
    except Exception as error:
        print(f"warning: could not parse {path}: {error}")
        return []


def write_jsonl(path: Path, rows):
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def read_tagged_rows(path: Path | None):
    if not path or not path.exists():
        return {}

    tagged = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            row = json.loads(line)
        except Exception:
            continue
        handle = str(row.get("handle") or "").lower()
        if handle:
            tagged[handle] = row
    return tagged


INACTIVE_TAGS = {
    "inactive",
    "no-longer-active",
    "no longer active",
    "status:inactive",
    "status:deleted",
    "status:suspended",
    "status:deactivated",
    "deleted",
    "suspended",
    "deactivated",
}


def boolish(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y", "inactive", "deleted", "suspended", "deactivated"}
    return bool(value)


def inactive_from_row(row):
    tags = [str(tag).strip().lower() for tag in row.get("tags") or []]
    return boolish(row.get("inactive") or row.get("no_longer_active") or row.get("deleted") or row.get("suspended")) or any(tag in INACTIVE_TAGS for tag in tags)


def score(row):
    return (
        row["dm_total"] * 5
        + row["replies_sent"] * 3
        + row["mentions_sent"]
        + row["retweets_sent"]
        + row["group_dm_msgs"] * 0.5
    )


def normalized_node(row):
    handle = row.get("handle") or f"id-{row.get('userId')}"
    user_id = row.get("userId")
    return {
        "id": str(user_id or f"handle:{handle}"),
        "userId": user_id,
        "handle": handle,
        "name": row.get("name") or handle,
        "bio": row.get("bio") or "",
        "followsYou": bool(row.get("follows_me")),
        "iFollow": bool(row.get("i_follow")),
        "mutual": bool(row.get("mutual")),
        "verified": bool(row.get("verified")),
        "dmTotal": int(row.get("dm_total") or 0),
        "dmSent": int(row.get("dm_sent") or 0),
        "dmReceived": int(row.get("dm_received") or 0),
        "dmFirst": row.get("dm_first"),
        "dmLast": row.get("dm_last"),
        "groupDmMessages": int(row.get("group_dm_msgs") or 0),
        "mentionsSent": int(row.get("mentions_sent") or 0),
        "repliesSent": int(row.get("replies_sent") or 0),
        "retweetsSent": int(row.get("retweets_sent") or 0),
        "interactionScore": float(row.get("interaction_score") or 0),
        "tags": row.get("tags") or [],
        "inactive": bool(row.get("inactive")),
        "inactiveReason": row.get("inactive_reason"),
        "url": f"https://x.com/{handle}",
    }


def build_edges(nodes):
    edges = []
    for node in nodes:
        if node.get("inactive"):
            continue
        if node["interactionScore"] < 10 or not node["id"] or str(node["id"]).startswith("id-"):
            continue
        if node["dmTotal"] > 0:
            edges.append({"source": "account:me", "target": node["id"], "type": "dm", "weight": node["dmTotal"]})
        if node["repliesSent"] > 0:
            edges.append({"source": "account:me", "target": node["id"], "type": "reply", "weight": node["repliesSent"]})
        if node["mentionsSent"] > 0:
            edges.append({"source": "account:me", "target": node["id"], "type": "mention", "weight": node["mentionsSent"]})
    return edges


def main():
    parser = argparse.ArgumentParser(description="Build X Circle data from an X archive export.")
    parser.add_argument("--archive-dir", default=str(Path.home() / "Documents/exports/X/data"))
    parser.add_argument("--out", default="public/generated/x-network.json")
    parser.add_argument("--normalized-dir", default="data/x-network")
    parser.add_argument("--tagged-following", default=None, help="Optional JSONL with handle/name/bio/tags/verified fields.")
    parser.add_argument("--me-id", default=None, help="Override your accountId if account.js is unavailable.")
    args = parser.parse_args()

    archive_root = Path(args.archive_dir).expanduser()
    output_path = Path(args.out).expanduser()
    normalized_dir = Path(args.normalized_dir).expanduser()
    tagged_path = Path(args.tagged_following).expanduser() if args.tagged_following else None

    output_path.parent.mkdir(parents=True, exist_ok=True)
    normalized_dir.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    print(f"Reading X archive from {archive_root}")

    followers = [row["follower"]["accountId"] for row in safe_load_js(archive_root, "follower.js") if row.get("follower")]
    following = [row["following"]["accountId"] for row in safe_load_js(archive_root, "following.js") if row.get("following")]
    contacts_raw = safe_load_js(archive_root, "contact.js")
    profile = safe_load_js(archive_root, "profile.js")
    account_rows = safe_load_js(archive_root, "account.js")
    account = account_rows[0].get("account", {}) if account_rows else {}
    me_id = args.me_id or account.get("accountId")

    tweets = safe_load_js(archive_root, "tweets.js")
    id_to_handle = {}
    handle_to_id = {}
    mentions_sent = Counter()
    reply_to_user = Counter()
    retweet_of = Counter()
    tweet_count = 0
    reply_tweets = 0
    retweet_tweets = 0
    mention_events = 0

    for wrapper in tweets:
        tweet = wrapper.get("tweet", {})
        tweet_count += 1
        for mention in tweet.get("entities", {}).get("user_mentions", []) or []:
            handle = mention.get("screen_name")
            user_id = mention.get("id_str") or mention.get("id")
            if handle and user_id:
                id_to_handle[str(user_id)] = handle
                handle_to_id[handle.lower()] = str(user_id)
                mentions_sent[handle.lower()] += 1
                mention_events += 1
        reply_id = tweet.get("in_reply_to_user_id_str") or tweet.get("in_reply_to_user_id")
        reply_handle = tweet.get("in_reply_to_screen_name")
        if reply_id and reply_handle:
            id_to_handle[str(reply_id)] = reply_handle
            handle_to_id[reply_handle.lower()] = str(reply_id)
            reply_to_user[reply_handle.lower()] += 1
            reply_tweets += 1
        full_text = tweet.get("full_text", "")
        if tweet.get("retweeted") or full_text.startswith("RT @"):
            retweet_tweets += 1
            match = re.match(r"RT @([A-Za-z0-9_]+):", full_text)
            if match:
                retweet_of[match.group(1).lower()] += 1

    dm_messages_with = Counter()
    dm_messages_sent_to = Counter()
    dm_messages_received_from = Counter()
    dm_first = {}
    dm_last = {}
    dm_month_sent = Counter()
    dm_month_received = Counter()
    dm_month_counterparties = defaultdict(set)
    for wrapper in safe_load_js(archive_root, "direct-messages.js"):
        conversation = wrapper.get("dmConversation", {})
        for message in conversation.get("messages", []):
            message_create = message.get("messageCreate")
            if not message_create:
                continue
            sender = message_create.get("senderId")
            recipient = message_create.get("recipientId")
            counterparty = recipient if sender == me_id else sender
            if not counterparty or counterparty == me_id:
                continue
            dm_messages_with[counterparty] += 1
            if sender == me_id:
                dm_messages_sent_to[counterparty] += 1
            else:
                dm_messages_received_from[counterparty] += 1
            created = message_create.get("createdAt")
            if not created:
                continue
            dm_first[counterparty] = min(dm_first.get(counterparty, created), created)
            dm_last[counterparty] = max(dm_last.get(counterparty, created), created)
            month = created[:7] if re.match(r"^\d{4}-\d{2}", created) else None
            if month:
                dm_month_counterparties[month].add(counterparty)
                if sender == me_id:
                    dm_month_sent[month] += 1
                else:
                    dm_month_received[month] += 1

    group_messages_by_user = Counter()
    for wrapper in safe_load_js(archive_root, "direct-messages-group.js"):
        conversation = wrapper.get("dmConversation", {})
        for message in conversation.get("messages", []):
            message_create = message.get("messageCreate")
            sender = message_create.get("senderId") if message_create else None
            if sender and sender != me_id:
                group_messages_by_user[sender] += 1

    likes_count = len(safe_load_js(archive_root, "like.js"))
    muted_ids = [row.get("muting", {}).get("accountId") for row in safe_load_js(archive_root, "mute.js") if row.get("muting")]
    blocked_ids = [row.get("blocking", {}).get("accountId") for row in safe_load_js(archive_root, "block.js") if row.get("blocking")]
    contacts = [
        {"emails": row.get("contact", {}).get("emails", []), "phoneNumbers": row.get("contact", {}).get("phoneNumbers", [])}
        for row in contacts_raw
    ]
    tagged = read_tagged_rows(tagged_path)

    follower_set = set(followers)
    following_set = set(following)
    mutual_ids = follower_set & following_set
    interactions = {}

    def get_row(key):
        if key not in interactions:
            interactions[key] = {
                "userId": None,
                "handle": None,
                "name": None,
                "bio": None,
                "follows_me": False,
                "i_follow": False,
                "mutual": False,
                "verified": None,
                "dm_total": 0,
                "dm_sent": 0,
                "dm_received": 0,
                "dm_first": None,
                "dm_last": None,
                "group_dm_msgs": 0,
                "mentions_sent": 0,
                "replies_sent": 0,
                "retweets_sent": 0,
                "tags": [],
                "inactive": False,
                "inactive_reason": None,
            }
        return interactions[key]

    for user_id in following:
        row = get_row(user_id)
        row["userId"] = user_id
        row["i_follow"] = True
    for user_id in followers:
        row = get_row(user_id)
        row["userId"] = user_id
        row["follows_me"] = True
    for user_id in mutual_ids:
        interactions[user_id]["mutual"] = True
    for user_id, total in dm_messages_with.items():
        row = get_row(user_id)
        row["userId"] = user_id
        row["dm_total"] = total
        row["dm_sent"] = dm_messages_sent_to[user_id]
        row["dm_received"] = dm_messages_received_from[user_id]
        row["dm_first"] = dm_first.get(user_id)
        row["dm_last"] = dm_last.get(user_id)
    for user_id, total in group_messages_by_user.items():
        row = get_row(user_id)
        row["userId"] = user_id
        row["group_dm_msgs"] = total

    for row in interactions.values():
        user_id = row.get("userId")
        if user_id and user_id in id_to_handle:
            row["handle"] = id_to_handle[user_id]

    def attach_handle_stat(handle, field, total):
        user_id = handle_to_id.get(handle.lower())
        if user_id:
            row = get_row(user_id)
            row["userId"] = user_id
            row["handle"] = id_to_handle.get(user_id, handle)
        else:
            row = get_row("handle:" + handle.lower())
            row["handle"] = handle
        row[field] = total

    for handle, total in mentions_sent.items():
        attach_handle_stat(handle, "mentions_sent", total)
    for handle, total in reply_to_user.items():
        attach_handle_stat(handle, "replies_sent", total)
    for handle, total in retweet_of.items():
        attach_handle_stat(handle, "retweets_sent", total)

    for row in interactions.values():
        handle = row.get("handle")
        if not handle:
            continue
        tagged_row = tagged.get(handle.lower())
        if not tagged_row:
            continue
        row["name"] = tagged_row.get("name") or row["name"]
        row["bio"] = tagged_row.get("bio") or row["bio"]
        row["verified"] = tagged_row.get("verified")
        row["tags"] = tagged_row.get("tags") or []
        row["inactive"] = inactive_from_row(tagged_row)
        row["inactive_reason"] = tagged_row.get("inactiveReason") or tagged_row.get("inactive_reason")

    interaction_rows = list(interactions.values())
    for row in interaction_rows:
        row["interaction_score"] = round(score(row), 1)
    interaction_rows.sort(key=lambda row: (-row["interaction_score"], row.get("userId") or "", (row.get("handle") or "").lower()))

    nodes = [normalized_node(row) for row in interaction_rows if row.get("handle") or row.get("interaction_score", 0) > 0]
    edges = build_edges(nodes)
    active_node_ids = {node["id"] for node in nodes}
    active_user_ids = {str(node["userId"]) for node in nodes if node.get("userId")}
    dm_monthly = [
        {
            "month": month,
            "sent": dm_month_sent[month],
            "received": dm_month_received[month],
            "uniqueCounterparties": len(dm_month_counterparties[month]),
        }
        for month in sorted(dm_month_counterparties)
    ]

    network = {
        "account": {
            "handle": account.get("username") or "me",
            "id": account.get("accountId") or me_id or "me",
            "displayName": account.get("accountDisplayName") or account.get("username") or "Me",
            "createdAt": account.get("createdAt"),
            "bio": profile[0].get("profile", {}).get("description", {}).get("bio") if profile else "",
        },
        "counts": {
            "followers": len(followers),
            "following": len(following),
            "mutuals": len(mutual_ids),
            "tweets_total": tweet_count,
            "tweets_replies": reply_tweets,
            "tweets_retweets": retweet_tweets,
            "tweet_mention_events": mention_events,
            "unique_handles_in_tweets": len(id_to_handle),
            "dm_conversations": len(safe_load_js(archive_root, "direct-messages.js")),
            "dm_counterparties": len(dm_messages_with),
            "dm_messages_total": sum(dm_messages_with.values()),
            "dm_messages_sent": sum(dm_messages_sent_to.values()),
            "dm_messages_received": sum(dm_messages_received_from.values()),
            "group_dm_messages_from_others": sum(group_messages_by_user.values()),
            "likes": likes_count,
            "muted": len(muted_ids),
            "blocked": len(blocked_ids),
            "imported_phone_contacts": len(contacts),
            "interactions_rows": len(interaction_rows),
            "interactions_with_score_gt_0": sum(1 for row in interaction_rows if row["interaction_score"] > 0),
            "inactive_profiles": sum(1 for row in interaction_rows if row.get("inactive")),
        },
        "nodes": nodes,
        "edges": edges,
        "followersOnlyIds": [user_id for user_id in followers if user_id not in active_user_ids and user_id not in active_node_ids],
        "followingOnlyIds": [user_id for user_id in following if user_id not in active_user_ids and user_id not in active_node_ids],
        "dmMonthly": dm_monthly,
    }

    output_path.write_text(json.dumps(network, indent=2, ensure_ascii=False), encoding="utf-8")
    write_jsonl(normalized_dir / "interactions.jsonl", interaction_rows)
    write_jsonl(normalized_dir / "followers.jsonl", [{"userId": user_id, "handle": id_to_handle.get(user_id), "mutual": user_id in mutual_ids} for user_id in sorted(followers)])
    write_jsonl(normalized_dir / "following.jsonl", [{"userId": user_id, "handle": id_to_handle.get(user_id), "mutual": user_id in mutual_ids} for user_id in sorted(following)])

    top_rows = [row for row in interaction_rows if row["interaction_score"] > 0 and not row.get("inactive")][:200]
    top_markdown = ["# Top X interactions", "", "| Rank | Handle | DMs | Replies | Mentions | RTs | Score |", "|---|---|---:|---:|---:|---:|---:|"]
    for index, row in enumerate(top_rows, 1):
        top_markdown.append(
            f"| {index} | @{row.get('handle') or row.get('userId')} | {row['dm_total']} | {row['replies_sent']} | {row['mentions_sent']} | {row['retweets_sent']} | {row['interaction_score']} |"
        )
    (normalized_dir / "top-interactions.md").write_text("\n".join(top_markdown) + "\n", encoding="utf-8")

    print(json.dumps({"output": str(output_path), "nodes": len(nodes), "edges": len(edges), "elapsed_seconds": round(time.time() - t0, 1)}, indent=2))


if __name__ == "__main__":
    main()
