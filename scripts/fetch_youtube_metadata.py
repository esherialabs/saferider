#!/usr/bin/env python3
"""
Utility script to fetch metadata (title, description, channel, duration)
for one or more YouTube videos without needing the YouTube Data API.

Examples:
  python scripts/fetch_youtube_metadata.py 9d680FtqSik lEGI--t-vGU
  python scripts/fetch_youtube_metadata.py https://youtube.com/shorts/9d680FtqSik

Outputs JSON to stdout that you can pipe into a file or use to update
static video definitions in the app.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.parse
import urllib.request


USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/129.0.0.0 Safari/537.36"
)


def fetch_html(video_id: str) -> str:
    url = f"https://www.youtube.com/watch?v={video_id}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=20) as response:  # nosec: B310
        return response.read().decode("utf-8", errors="ignore")


def _decode_json_parse_payload(raw: str) -> str:
    # The payload is inside JSON.parse("...") where the string uses JavaScript
    # escaping (e.g., \n, \u0026). Turn it into proper JSON text.
    return bytes(raw, "utf-8").decode("unicode_escape")


def _extract_json_block(source: str, marker: str) -> dict:
    idx = source.find(marker)
    if idx == -1:
        raise ValueError(f"Marker {marker!r} not found in YouTube HTML.")

    idx += len(marker)
    # Skip whitespace and equal signs
    while idx < len(source) and source[idx] in " \n\r\t=":
        idx += 1

    if source.startswith("JSON.parse", idx):
        match = re.match(r'JSON\.parse\("([^"]+)"\)', source[idx:])
        if not match:
            raise ValueError("Could not parse JSON.parse payload.")
        payload = _decode_json_parse_payload(match.group(1))
        return json.loads(payload)

    # Otherwise expect a JSON object starting with '{'
    while idx < len(source) and source[idx] not in "{":
        idx += 1

    if idx >= len(source) or source[idx] != "{":
        raise ValueError("Expected JSON object start '{' after marker.")

    brace_level = 0
    json_chars = []
    for pos in range(idx, len(source)):
        char = source[pos]
        json_chars.append(char)
        if char == "{":
            brace_level += 1
        elif char == "}":
            brace_level -= 1
            if brace_level == 0:
                break
    json_text = "".join(json_chars)
    return json.loads(json_text)


def extract_metadata(video_id: str, html: str) -> dict:
    player_data = _extract_json_block(html, "ytInitialPlayerResponse = ")
    details = player_data.get("videoDetails") or {}

    return {
        "videoId": video_id,
        "title": details.get("title"),
        "description": details.get("shortDescription"),
        "channel": details.get("author") or details.get("channelId"),
        "lengthSeconds": int(details["lengthSeconds"])
        if details.get("lengthSeconds")
        else None,
    }


def normalise_id(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("Empty video identifier provided.")

    if "youtube.com" in value or "youtu.be" in value:
        parsed = urllib.parse.urlparse(value)
        if parsed.netloc.endswith("youtu.be"):
            candidate = parsed.path.strip("/")
            if not candidate:
                raise ValueError(f"Missing video id in URL: {value}")
            return candidate

        query = urllib.parse.parse_qs(parsed.query or "")
        if "v" in query:
            return query["v"][0]
        # Shorts URLs keep the id in the path: /shorts/<id>
        parts = [segment for segment in parsed.path.split("/") if segment]
        if parts and parts[0] == "shorts" and len(parts) > 1:
            return parts[1]
        raise ValueError(f"Could not extract video id from URL: {value}")

    return value


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "videos",
        metavar="VIDEO",
        nargs="+",
        help="Video IDs or URLs to fetch metadata for.",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty-print JSON output.",
    )
    args = parser.parse_args(argv)

    results = []
    errors = {}
    for raw in args.videos:
        try:
            video_id = normalise_id(raw)
            html = fetch_html(video_id)
            results.append(extract_metadata(video_id, html))
        except Exception as exc:  # pylint: disable=broad-except
            errors[raw] = str(exc)

    output = {"results": results, "errors": errors}
    json.dump(output, sys.stdout, indent=2 if args.pretty else None)
    sys.stdout.write("\n")

    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
