#!/usr/bin/env python3
"""
Small test harness to POST sample payloads to an Apps Script exec URL.
Set environment variable `EXEC_URL` or pass `--exec`.

This script is intentionally simple (no external deps beyond stdlib).
"""

import os
import sys
import argparse
import json
from urllib import request


def post_json(url, payload):
    data = json.dumps(payload).encode('utf-8')
    req = request.Request(url, data=data, headers={'Content-Type': 'application/json'})
    with request.urlopen(req) as resp:
        return resp.read().decode('utf-8')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--exec', help='Apps Script exec URL (or use EXEC_URL env var)')
    args = parser.parse_args()

    exec_url = args.exec or os.getenv('EXEC_URL') or os.getenv('APPS_SCRIPT_EXEC_URL')
    if not exec_url:
        print('Provide --exec or set EXEC_URL / APPS_SCRIPT_EXEC_URL')
        sys.exit(2)

    # Known test number (example only)
    test_phone = '+15712455560'

    samples = [
        ('ping (GET)', None),
        ('inbound', {
            'event_type': 'inbound',
            'from': test_phone,
            'to': '+13016522378',
            'body': 'Hello from test harness',
            'message_sid': 'SMTESTINB1'
        }),
        ('delivery', {
            'event_type': 'delivery',
            'to': test_phone,
            'message_sid': 'SMTESTDLV1',
            'message_status': 'delivered',
            'delivered_at': '2025-11-23T00:00:00Z'
        }),
        ('click', {
            'event_type': 'click',
            'to': test_phone,
            'clicked_at': '2025-11-23T00:05:00Z'
        }),
        ('stop', {
            'event_type': 'inbound',
            'from': test_phone,
            'body': 'STOP'
        }),
        ('start', {
            'event_type': 'inbound',
            'from': test_phone,
            'body': 'START'
        }),
    ]

    for name, payload in samples:
        print('---')
        if payload is None:
            # ping via GET
            try:
                with request.urlopen(exec_url + '?ping=1') as r:
                    print('ping ->', r.read().decode('utf-8'))
            except Exception as e:
                print('ping error:', e)
            continue

        print(f"POST {name}: {json.dumps(payload)}")
        try:
            out = post_json(exec_url, payload)
            print('response:', out)
        except Exception as e:
            print('error posting:', e)


if __name__ == '__main__':
    main()
