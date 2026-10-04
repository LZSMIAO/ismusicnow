#!/usr/bin/env python3
"""MUISM public YouTube Music catalogue adapter; no account credentials required."""
import functools
import json
import sys
import requests
from ytmusicapi import YTMusic

operation, value = sys.argv[1:3]
kind = sys.argv[3] if len(sys.argv) > 3 else 'track'
if not value or len(value) > 1000:
    raise ValueError('Invalid catalogue input')
session = requests.Session()
session.request = functools.partial(session.request, timeout=6)
yt = YTMusic(requests_session=session)
if operation == 'search':
    filters = {'track': 'songs', 'artist': 'artists', 'album': 'albums', 'playlist': 'playlists'}
    result = yt.search(value, filter=filters[kind], limit=20, ignore_spelling=True)[:20]
elif operation == 'artist':
    result = yt.get_artist(value)
elif operation == 'album':
    result = yt.get_album(value)
else:
    raise ValueError('Invalid catalogue operation')
print(json.dumps(result, ensure_ascii=False))
