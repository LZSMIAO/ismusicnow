#!/usr/bin/env python3
"""Run the pinned Votify adapter with the authenticated cookie session."""

import os
import runpy
import time
from importlib.metadata import version

# Use the compatible backend for Librespot's legacy generated protobuf modules.
os.environ['PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION'] = 'python'

from votify.api.api import SpotifyApi
from votify.api.librespot import Librespot
import librespot.core


def initialize_librespot(api):
    token = api._access_token
    expires = api._authorization_expire_time
    if not token or time.time() >= expires - 30:
        raise RuntimeError('SPOTIFY_SESSION_EXPIRED')

    original_provider = librespot.core.TokenProvider

    class CookieSessionTokens(original_provider):
        def get_token(self, *scopes):
            if time.time() >= expires - 30:
                raise RuntimeError('SPOTIFY_SESSION_EXPIRED')
            return self.StoredToken({
                'accessToken': token,
                'expiresIn': int(expires - time.time()),
                'scope': list(scopes),
            })

    # An adapter process handles one download and one configured account.
    # Reuse the authenticated token; retired Keymaster reauthentication fails.
    librespot.core.TokenProvider = CookieSessionTokens
    try:
        for attempt in range(3):
            try:
                api.librespot = Librespot(access_token=token)
                break
            except ConnectionRefusedError:
                if attempt == 2:
                    raise
    finally:
        librespot.core.TokenProvider = original_provider


if __name__ == '__main__':
    if version('votify') != '1.9.9':
        raise RuntimeError('Unsupported Votify version: rebuild the pinned adapter')
    SpotifyApi._initialize_librespot = initialize_librespot
    runpy.run_module('votify', run_name='__main__')
