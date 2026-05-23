#!/bin/bash
# Start local server for HTML5 AI Player
# This is required to bypass CORS restrictions when calling AI APIs

echo "🎬 Starting HTML5 AI Player server..."
echo ""
echo "📡 Server running at: http://localhost:8000"
echo ""
echo "👉 Open your browser and go to:"
echo "   http://localhost:8000"
echo ""
echo "⚠️  Do NOT open index.html directly (file://) — AI API calls will fail!"
echo ""
echo "Press Ctrl+C to stop the server."
echo ""

cd "$(dirname "$0")"
python3 -m http.server 8000
