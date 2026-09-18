import sys
import os

# إضافة المجلد الأب لمسار Python
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app

# Vercel يحتاج متغير اسمه app
if __name__ == "__main__":
    app.run()