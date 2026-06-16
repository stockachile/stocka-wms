import os
import re

replacements = {
    "📦": '<i class="ri-box-3-line"></i>',
    "🛒": '<i class="ri-shopping-cart-2-line"></i>',
    "🚚": '<i class="ri-truck-line"></i>',
    "🔄": '<i class="ri-loop-right-line"></i>',
    "🏭": '<i class="ri-building-2-line"></i>',
    "⚠️": '<i class="ri-error-warning-line"></i>',
    "🔌": '<i class="ri-plug-line"></i>',
    "👤": '<i class="ri-user-line"></i>',
    "📋": '<i class="ri-clipboard-line"></i>',
    "📥": '<i class="ri-inbox-archive-line"></i>',
    "👥": '<i class="ri-team-line"></i>',
    "🔎": '<i class="ri-search-line"></i>',
    "🔍": '<i class="ri-search-line"></i>',
    "✔️": '<i class="ri-check-line"></i>',
    "🔑": '<i class="ri-key-line"></i>',
    "📖": '<i class="ri-book-read-line"></i>',
    "🔗": '<i class="ri-links-line"></i>',
    "⏳": '<i class="ri-timer-line"></i>',
    "🛍️": '<i class="ri-shopping-bag-3-line"></i>',
    "🗂️": '<i class="ri-folder-open-line"></i>'
}

def replace_emojis_in_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    for emoji, icon_html in replacements.items():
        content = content.replace(emoji, icon_html)

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

js_files = [
    'js/admin.js',
    'js/app.js'
]

for f in js_files:
    if os.path.exists(f):
        replace_emojis_in_file(f)
        print(f"Updated {f}")
    else:
        print(f"File not found: {f}")
