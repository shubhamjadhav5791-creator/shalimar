#!/bin/bash
cd "$(dirname "$0")"
echo "Starting Saffron & Ember Restaurant QR Ordering & POS Server..."
/usr/bin/ruby server.rb
