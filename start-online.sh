#!/bin/sh
cd "$(dirname "$0")/server"
(sleep 1; (xdg-open http://localhost:3000 || open http://localhost:3000) >/dev/null 2>&1) &
node server.js
