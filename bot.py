import os
import json
import logging
import asyncio
import sys
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv
from telegram import (
    Update, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
)
from telegram.ext import (
    Application, CommandHandler, CallbackQueryHandler,
    MessageHandler, filters, ContextTypes
)

# ── Ayarlar ──────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

# Gizli anahtarlar yalnızca .env üzerinden (GitHub'a sabit token yazmayın)
BOT_TOKEN  = os.getenv("BOT_TOKEN", "").strip()
ADMIN_ID   = int(os.getenv("ADMIN_ID", "0") or "0")
CHANNEL_1  = os.getenv("CHANNEL_1",  "@pusulasocial")
CHANNEL_2  = os.getenv("CHANNEL_2",  "@deneme789s")
PUZZLE_URL = os.getenv("PUZZLE_URL", "https://pusulagame.github.io/pusula-puzzle/puzzle.html")
PENALTY_URL = os.getenv("PENALTY_URL", "https://pusulagame.github.io/pusulabet-penalti/")
MINI_APP_URL = "https://t.me/pusulabetgame_bot/puzzle"
PENALTY_MINI_APP_URL = "https://t.me/pusulabetgame_bot/penalti"

DATA_FILE   = str(BASE_DIR / "data.json")   # cwd'den bağımsız
CONFIG_FILE = str(BASE_DIR / "config.json")

# Penalty → Google Sheets (index.html ve .env ile aynı deployment olmalı)
PENALTY_SHEETS_URL = os.getenv(
    "PENALTY_SHEETS_URL",
    "https://script.google.com/macros/s/AKfycbx9L5_DApizBucQXBfWzp-JJBLig1XQ6OmBhVadf4RawvqQVCVsyZ47sFZ9onCJASfq/exec",
)

# GitHub — data.json senkronu (isteğe bağlı); token sadece GH_TOKEN ile
GH_TOKEN  = os.getenv("GH_TOKEN", "").strip()
GH_OWNER  = "pusulagame"
GH_REPO   = "pusula-puzzle"
GH_BRANCH = "main"

logging.basicConfig(
    format="%(asctime)s | %(levelname)s | %(message)s",
    level=logging.INFO
)
logger = logging.getLogger(__name__)


class PenaltyDuplicateError(Exception):
    """Aynı Telegram ID ile daha önce penaltı tamamlandı."""

    pass


class PenaltyPusulabetRequiredError(Exception):
    """Telegram ile katılımda Pusulabet kullanıcı adı zorunlu."""

    pass


def _norm_pb(s: str) -> str:
    import re

    return re.sub(r"\s+", " ", (s or "").strip())[:24]


def _penalty_has_played(telegram_id: str, g: dict) -> bool:
    tid = str(telegram_id or "").strip()
    if not tid:
        return False
    for r in g.get("results", []):
        if str(r.get("telegram_id") or "") == tid:
            return True
    return False


# ── Veri Yönetimi ─────────────────────────────────────────────────────────────
def load_data() -> dict:
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {
        "games": {
            "puzzle": {
                "active": False,
                "total_plays": 0,
                "started_at": None,
                "players": []
            },
            "penalty": {
                "active": False,
                "total_plays": 0,
                "started_at": None,
                "players": [],
                "total_results": 0,
                "total_wins": 0,
                "results": [],
                "penalty_users": {},
            }
        }
    }

def save_data(data: dict):
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    threading.Thread(target=_push_data_gh, args=(data,), daemon=True).start()

def _push_data_gh(data: dict):
    import base64, urllib.request, urllib.error
    try:
        url = f"https://api.github.com/repos/{GH_OWNER}/{GH_REPO}/contents/data.json"
        hdrs = {"Authorization": f"token {GH_TOKEN}",
                "Accept": "application/vnd.github.v3+json",
                "Content-Type": "application/json"}
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=hdrs)) as r:
                sha = json.loads(r.read()).get("sha")
        except urllib.error.HTTPError:
            sha = None
        content = base64.b64encode(json.dumps(data, ensure_ascii=False, indent=2).encode()).decode()
        body = {"message": "data.json guncellendi", "content": content, "branch": GH_BRANCH}
        if sha:
            body["sha"] = sha
        put = urllib.request.Request(url, method="PUT", data=json.dumps(body).encode(), headers=hdrs)
        urllib.request.urlopen(put)
        logger.info("data.json GitHub'a push edildi")
    except Exception as e:
        logger.warning(f"GitHub push hatasi: {e}")

def load_config() -> dict:
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {
        "giris_btn_text": "🎰 Pusulabet Giriş!",
        "giris_btn_link": "https://t2m.io/guncelpusulabet",
        "welcome_title": "Merhaba!",
        "welcome_text": "🧩 Pusulabet Puzzle\'a hoş geldin!\n🎯 Görseli 3 dakika içinde tamamla.\n💥 Süren biterse bomba patlıyor!",
        "channel_msg1": "🧩 Pusulabet Puzzle 3 dakika içerisinde çöz, Freespin kodunu bul!",
        "channel_msg2": "⏰ Süren biterse üzülme, @pusulasocial takip et kazanmaya devam et!",
        "kanal_baslik": "🎮 *Pusulabet Game*",
    }

def save_config(cfg: dict):
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


# ── Yardımcı ─────────────────────────────────────────────────────────────────
def is_admin(user_id: int) -> bool:
    return user_id == ADMIN_ID

def get_game(data: dict, game: str) -> dict:
    """Oyun verisini döner, yoksa oluşturur."""
    if "games" not in data:
        data["games"] = {}
    if game not in data["games"]:
        data["games"][game] = {
            "active": False,
            "total_plays": 0,
            "started_at": None,
            "players": []
        }
    return data["games"][game]

def game_keyboard(game: str) -> InlineKeyboardMarkup:
    """Kullanıcıya gönderilecek klavye — oyun bazlı Mini App butonu içerir."""
    game = (game or "").lower().strip()
    if game in ("penalty", "penalti"):
        return InlineKeyboardMarkup([
            [InlineKeyboardButton("🎮 Penaltı Oyna!", web_app=WebAppInfo(url=PENALTY_URL))],
            [InlineKeyboardButton("🎰 Pusulabet Giriş", url="https://t2m.io/guncelpusulabet")],
        ])
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("🎮 Puzzle Oyna!", web_app=WebAppInfo(url=PUZZLE_URL))]
    ])

def start_keyboard(data: dict, user_id: int) -> InlineKeyboardMarkup:
    """Start mesajı için (güvenli) çoklu oyun butonları."""
    buttons = []
    puzzle = get_game(data, "puzzle")
    penalty = get_game(data, "penalty")

    if puzzle.get("active") or is_admin(user_id):
        buttons.append([InlineKeyboardButton("🎮 Puzzle Oyna!", web_app=WebAppInfo(url=PUZZLE_URL))])
    if penalty.get("active") or is_admin(user_id):
        buttons.append([InlineKeyboardButton("🎮 Penaltı Oyna!", web_app=WebAppInfo(url=PENALTY_URL))])

    return InlineKeyboardMarkup(buttons) if buttons else InlineKeyboardMarkup([])

def channel_keyboard(channel: str) -> InlineKeyboardMarkup:
    cfg = load_config()
    btn_text = cfg.get("giris_btn_text", "🎰 Pusulabet Giriş!")
    btn_link = cfg.get("giris_btn_link", "https://t2m.io/guncelpusulabet")
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("🎮 Puzzle Oyna!", url="https://t.me/pusulabetgame_bot/puzzle")],
        [InlineKeyboardButton(btn_text, url=btn_link)]
    ])

def penalty_channel_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("🎮 Penaltı Oyna!", url=PENALTY_MINI_APP_URL)],
        [InlineKeyboardButton("🎰 Pusulabet Giriş", url="https://t2m.io/guncelpusulabet")],
    ])

def penalty_text() -> str:
    return "Pusula Penaltı'da 5 Penaltının 3'ünü at Freespin Kazan!"

def share_text(channel: str) -> str:
    cfg = load_config()
    msg1 = cfg.get("channel_msg1", "Pusulabet Puzzle 3 dakika içerisinde çöz, Freespin kodunu bul!")
    msg2 = cfg.get("channel_msg2", "Süren biterse üzülme, @pusulasocial takip et kazanmaya devam et!")
    baslik = cfg.get("kanal_baslik", "🎮 *Pusulabet Game*")
    # Escape MarkdownV2 special chars
    def esc(t): return t.replace("!","\\!").replace(".","\\.")
    return f"{baslik}\n\n{esc(msg1)}\n\n{esc(msg2)}"


# ── Komutlar ──────────────────────────────────────────────────────────────────

async def cmd_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    data = load_data()
    user = update.effective_user

    puzzle = get_game(data, "puzzle")
    penalty = get_game(data, "penalty")
    if not (puzzle.get("active") or penalty.get("active")) and not is_admin(user.id):
        await update.message.reply_text(
            "⚠️ *Oyun şu an aktif değil.*\n\n"
            "Yeni bir etkinlik başladığında burada duyurulacak!\n"
            f"📢 Takipte kal: {CHANNEL_1}",
            parse_mode="Markdown"
        )
        return

    # /start bir menü; oyun test modunda bile admin dışında buton gösterimi start_keyboard ile kontrol edilir
    puzzle["total_plays"] = int(puzzle.get("total_plays", 0)) + 1
    save_data(data)

    cfg = load_config()
    welcome_title = cfg.get("welcome_title", "Merhaba!")
    welcome_text = cfg.get("welcome_text", "🧩 Pusulabet Puzzle'a hoş geldin!\n🎯 Görseli 3 dakika içinde tamamla.\n💥 Süren biterse bomba patlıyor!")
    welcome_text = welcome_text.replace("\\n", "\n")
    await update.message.reply_text(
        f"👋 {welcome_title} *{user.first_name}*!\n\n{welcome_text}\n\nHazırsan aşağıdan başla 👇",
        parse_mode="Markdown",
        reply_markup=start_keyboard(data, user.id)
    )

async def cmd_oyna(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    data = load_data()
    user = update.effective_user
    game = get_game(data, "puzzle")

    if not game["active"] and not is_admin(user.id):
        await update.message.reply_text(
            "🔒 *Oyun şu an aktif değil.*\n\n"
            f"Etkinlik duyuruları için {CHANNEL_1} kanalını takip et!",
            parse_mode="Markdown"
        )
        return

    # Test modunda sadece admin oynayabilir
    if game.get("test_mode") and not is_admin(user.id):
        await update.message.reply_text(
            "🔒 *Oyun şu an aktif değil.*\n\n"
            f"Etkinlik duyuruları için {CHANNEL_1} kanalını takip et!",
            parse_mode="Markdown"
        )
        return

    game["total_plays"] += 1
    game["players"].append({
        "id": user.id,
        "username": user.username or "",
        "name": user.full_name or "",
        "time": datetime.now().strftime("%H:%M:%S")
    })
    save_data(data)

    await update.message.reply_text(
        "🎮 *Puzzle başlıyor!*\n\n"
        "⏱ 3 dakikan var\n"
        "🧩 25 parça (5×5)\n"
        "💣 Süre biterse bomba patlar!\n\n"
        "👇 Butona bas ve oyna:",
        parse_mode="Markdown",
        reply_markup=game_keyboard("puzzle")
    )

async def cmd_penalti(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Kullanıcı: /penalti veya /penalty — Penaltı oyununu başlatır."""
    data = load_data()
    user = update.effective_user
    game = get_game(data, "penalty")

    if not game.get("active") and not is_admin(user.id):
        await update.message.reply_text(
            "🔒 *Etkinlik sona ermiştir.*\n\n"
            f"Yeni etkinlik duyuruları için {CHANNEL_1} kanalını takip et!",
            parse_mode="Markdown"
        )
        return

    if game.get("test_mode") and not is_admin(user.id):
        await update.message.reply_text(
            "🔒 *Oyun şu an aktif değil.*\n\n"
            f"Etkinlik duyuruları için {CHANNEL_1} kanalını takip et!",
            parse_mode="Markdown"
        )
        return

    game["total_plays"] = int(game.get("total_plays", 0)) + 1
    game.setdefault("players", []).append({
        "id": user.id,
        "username": user.username or "",
        "name": user.full_name or "",
        "time": datetime.now().strftime("%H:%M:%S")
    })
    save_data(data)

    await update.message.reply_text(
        penalty_text(),
        parse_mode="Markdown",
        reply_markup=game_keyboard("penalty")
    )

async def cmd_kanal(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Admin: hangi kanala paylaşılacağını sorar, sonra gönderir."""
    if not is_admin(update.effective_user.id):
        await update.message.reply_text("⛔ Bu komut sadece admin içindir.")
        return

    data = load_data()
    # Varsayılan: penalty paylaş (isteğe bağlı: /kanal puzzle)
    game_name = (ctx.args[0].lower() if ctx.args else "penalty")
    if game_name in ("penalti",):
        game_name = "penalty"
    game = get_game(data, game_name)
    if not game.get("active"):
        await update.message.reply_text(f"⚠️ {game_name} aktif değil! Önce /ac {game_name} komutu ile aktif et.")
        return

    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton(f"📢 {CHANNEL_1}", callback_data=f"share:{game_name}:{CHANNEL_1}")],
        [InlineKeyboardButton(f"📢 {CHANNEL_2}", callback_data=f"share:{game_name}:{CHANNEL_2}")],
        [InlineKeyboardButton("📢 Her İkisi", callback_data=f"share:{game_name}:both")],
        [InlineKeyboardButton("❌ İptal", callback_data=f"share:{game_name}:cancel")],
    ])
    await update.message.reply_text(
        "📢 *Hangi kanala paylaşayım?*",
        parse_mode="Markdown",
        reply_markup=keyboard
    )

async def callback_share(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    if not is_admin(query.from_user.id):
        return

    parts = query.data.split(":")
    # share:<game>:<action>
    game_name = parts[1] if len(parts) > 2 else "puzzle"
    action = parts[2] if len(parts) > 2 else parts[1]

    if action == "cancel":
        await query.edit_message_text("❌ İptal edildi.")
        return

    channels = []
    if action == "both":
        channels = [CHANNEL_1, CHANNEL_2]
    else:
        channels = [action]

    text = penalty_text() if game_name == "penalty" else share_text(CHANNEL_1)
    markup = penalty_channel_keyboard() if game_name == "penalty" else channel_keyboard(CHANNEL_1)

    results = []
    for ch in channels:
        try:
            await ctx.bot.send_message(
                chat_id=ch,
                text=text,
                parse_mode="Markdown",
                reply_markup=markup
            )
            results.append(f"✅ {ch}")
        except Exception as e:
            results.append(f"❌ {ch}: {e}")

    await query.edit_message_text(
        "📤 *Paylaşım sonuçları:*\n\n" + "\n".join(results),
        parse_mode="Markdown"
    )

async def cmd_ac(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Admin: /ac puzzle — belirtilen oyunu açar."""
    if not is_admin(update.effective_user.id):
        await update.message.reply_text("⛔ Bu komut sadece admin içindir.")
        return

    args = ctx.args
    if not args:
        await update.message.reply_text(
            "❓ Hangi oyunu açmak istiyorsun?\n"
            "Örnek: `/ac puzzle`",
            parse_mode="Markdown"
        )
        return

    game_name = args[0].lower()
    data = load_data()
    game = get_game(data, game_name)

    if game["active"]:
        await update.message.reply_text(f"✅ *{game_name}* zaten aktif!", parse_mode="Markdown")
        return

    game["active"] = True
    game["started_at"] = datetime.now().isoformat()
    game["test_mode"] = False   # test modunu kapat, herkes görebilir
    save_data(data)

    await update.message.reply_text(
        f"✅ *{game_name.upper()}* AKTİF edildi!\n\n"
        "Kullanıcılar artık oynayabilir.\n"
        "Kanala paylaşmak için /kanal komutunu kullan.",
        parse_mode="Markdown"
    )
    logger.info(f"{game_name} AKTİF — admin: {ADMIN_ID}")


async def cmd_kapat(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Admin: /kapat puzzle — belirtilen oyunu kapatır."""
    if not is_admin(update.effective_user.id):
        await update.message.reply_text("⛔ Bu komut sadece admin içindir.")
        return

    args = ctx.args
    if not args:
        await update.message.reply_text(
            "❓ Hangi oyunu kapatmak istiyorsun?\n"
            "Örnek: `/kapat puzzle`",
            parse_mode="Markdown"
        )
        return

    game_name = args[0].lower()
    data = load_data()
    game = get_game(data, game_name)

    if not game["active"]:
        await update.message.reply_text(f"🔒 *{game_name}* zaten kapalı!", parse_mode="Markdown")
        return

    game["active"] = False
    game["test_mode"] = False
    save_data(data)

    await update.message.reply_text(
        f"🔒 *{game_name.upper()}* KAPATILDI.\n\n"
        "Kullanıcılar artık oynayamaz."
        + ("\n\nEtkinlik sona ermiştir." if game_name in ("penalty", "penalti") else ""),
        parse_mode="Markdown"
    )
    logger.info(f"{game_name} KAPATILDI — admin: {ADMIN_ID}")

async def cmd_durum(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Admin: bot durumunu gösterir."""
    if not is_admin(update.effective_user.id):
        await update.message.reply_text("⛔ Bu komut sadece admin içindir.")
        return

    data = load_data()
    # Son 5 oyuncuyu listele
    games = data.get("games", {})
    rapor = "📊 *Etkinlik Raporu*\n\n"
    for gname, gdata in games.items():
        durum_g = "🟢 AKTİF" if gdata.get("active") else "🔴 KAPALI"
        players_g = gdata.get("players", [])
        unique_g = len(set(p["id"] for p in players_g))
        rapor += (
            f"🎮 *{gname.upper()}* — {durum_g}\n"
            f"   Toplam açılış: *{gdata.get('total_plays', 0)}*\n"
            f"   Benzersiz oyuncu: *{unique_g}*\n\n"
        )
    if not games:
        rapor += "Henüz hiç oyun oluşturulmadı.\n\n"
    rapor += "*/liste* — Oyuncu listesi\n*/sifirla* — Sıfırla"

    await update.message.reply_text(rapor, parse_mode="Markdown")

async def handle_webapp_data(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Mini App sendData — penalty / puzzle ayrımı; penalty sonuçlarını kaydeder."""
    data_store = load_data()
    user = update.effective_user
    msg = update.effective_message or update.message
    if not msg or not msg.web_app_data:
        return

    raw = (msg.web_app_data.data or "").strip()
    logger.info("web_app_data user=%s raw_len=%s raw=%s", user.id, len(raw), raw[:2000])

    payload = None
    if raw:
        try:
            payload = json.loads(raw)
        except Exception as e:
            logger.exception("web_app_data json parse error: %s", e)
            payload = None

    # JSON bekleniyordu ama parse olmadı → puzzle'a düşürme
    if raw.startswith("{") and payload is None:
        try:
            await msg.reply_text("Kayıt okunamadı (format hatası). Tekrar dene veya yöneticiye yaz.")
        except Exception as e:
            logger.warning("reply_text (json err): %s", e)
        return

    # Penalty
    if isinstance(payload, dict) and payload.get("game") in ("penalty", "penalti"):
        try:
            result_obj = _record_penalty_result(
                payload=payload,
                data_store=data_store,
                telegram_id=str(user.id),
                telegram_username=user.username or "",
                source="telegram",
            )
        except PenaltyDuplicateError:
            try:
                await msg.reply_text(
                    "Bu Telegram hesabıyla penaltıya zaten katıldın. Her kullanıcı yalnızca bir kez oynayabilir."
                )
            except Exception:
                pass
            return
        except PenaltyPusulabetRequiredError:
            try:
                await msg.reply_text(
                    "Pusulabet kullanıcı adı gerekli. Oyuna başlamadan adını girip tekrar dene."
                )
            except Exception:
                pass
            return
        except Exception as e:
            logger.exception("Penalty record error: %s", e)
            try:
                await msg.reply_text("⚠️ Sonuç kaydedilemedi. Yöneticiye bildir.")
            except Exception:
                pass
            return

        # Kullanıcıya kısa geri bildirim
        try:
            if result_obj.get("won"):
                if result_obj.get("sheet_status") == "ok":
                    await msg.reply_text(f"✅ Penaltı kaydedildi: {result_obj.get('score')}. Tabloya işlendi.")
                elif result_obj.get("sheet_status") == "failed":
                    await msg.reply_text("⚠️ Skor kaydedildi ama tabloya yazılamadı (sheet). Yöneticiye bildir.")
                else:
                    await msg.reply_text(f"✅ Penaltı kaydedildi: {result_obj.get('score')}.")
            else:
                await msg.reply_text(f"Penaltı bitti ({result_obj.get('score')}). Kaydedildi.")
        except Exception as e:
            logger.warning("reply_text: %s", e)
        return

    # Puzzle: sadece played:… (JSON penalty ile karışmasın)
    if raw.startswith("played:"):
        game = get_game(data_store, "puzzle")
        game.setdefault("players", []).append({
            "id": user.id,
            "username": user.username or "",
            "name": user.full_name or "",
            "time": datetime.now().strftime("%d.%m %H:%M")
        })
        game["total_plays"] = int(game.get("total_plays", 0)) + 1
        save_data(data_store)
        return

    logger.warning("Bilinmeyen web_app_data: %s", raw[:400])
    try:
        await msg.reply_text(
            "Bu veri tanınmadı (penaltı/puzzle kaydı yapılmadı). Uygulamayı güncelle."
        )
    except Exception as e:
        logger.warning("reply_text (unknown): %s", e)

def _record_penalty_result(
    payload: dict,
    data_store: dict,
    telegram_id: str,
    telegram_username: str = "",
    source: str = "unknown",
) -> dict:
    """
    Penalty sonucunu data.json'a yazar.
    - results: HERKES girer (won True/False)
    - total_results: her oyun sonunda +1
    - total_wins: sadece won ise +1
    - sheet_status: ok/failed/skipped
    """
    g = get_game(data_store, "penalty")
    g.setdefault("results", [])
    g.setdefault("penalty_users", {})

    goals = int(payload.get("goals", 0) or 0)
    total = int(payload.get("total", 5) or 5)
    score = payload.get("score") or f"{goals}/{total}"
    if goals == 0 and isinstance(score, str) and "/" in score:
        try:
            a, _b = score.split("/", 1)
            goals = int(a.strip())
        except Exception:
            pass
    # Kazanma koşulu daima goals >= 3 üzerinden hesaplanır.
    # Frontend'den gelen "won" alanına güvenilmez (False gönderilse bile goals yeterliyse kazandı sayılır).
    won = goals >= 3

    pusulabet_user = _norm_pb(
        payload.get("pusulabet_username") or payload.get("pb_user") or ""
    )
    if source == "telegram":
        telegram_id = str(telegram_id or "").strip()
        telegram_username = (telegram_username or payload.get("telegram_kullanici") or "").strip()
    else:
        telegram_username = payload.get("telegram_kullanici") or telegram_username or ""
        telegram_id = str(payload.get("telegram_id") or telegram_id or "").strip()

    if telegram_id:
        if _penalty_has_played(telegram_id, g):
            raise PenaltyDuplicateError()
        if not pusulabet_user:
            raise PenaltyPusulabetRequiredError()

    result_obj = {
        "tarih": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "telegram_kullanici": telegram_username,
        "telegram_id": str(telegram_id),
        "pusulabet_kullanici": pusulabet_user,
        "score": score,
        "goals": goals,
        "total": total,
        "won": won,
        "source": source,
    }

    # sayaçlar
    g["total_results"] = int(g.get("total_results", 0)) + 1
    if won:
        g["total_wins"] = int(g.get("total_wins", 0)) + 1

    # Sheets'e HERKES gönderilir (kazanan ve kaybeden); kayıt filtresi AppScript'e bırakılmaz.
    ok = _send_penalty_result_to_sheets(result_obj)
    result_obj["sheet_status"] = "ok" if ok else "failed"

    g["results"].append(result_obj)
    if telegram_id:
        g["penalty_users"][telegram_id] = {
            "pusulabet_username": pusulabet_user,
            "tarih": result_obj["tarih"],
        }
    save_data(data_store)

    logger.info(
        "Penalty recorded source=%s goals=%s/%s won=%s sheet=%s tg_id=%s pb=%s",
        source,
        goals,
        total,
        won,
        result_obj.get("sheet_status"),
        telegram_id,
        pusulabet_user or "-",
    )
    return result_obj

def _post_json_apps_script(url: str, body: dict, timeout: float = 25.0) -> None:
    """
    Google Apps Script Web App genelde 302 verir; requests allow_redirects en güvenilir yol.
    Yoksa http.client ile yönlendirme takip.
    """
    try:
        import requests

        r = requests.post(url, json=body, timeout=timeout, allow_redirects=True)
        if r.status_code >= 400:
            raise RuntimeError(f"Sheets HTTP {r.status_code}: {r.text[:300]}")
        logger.info("Penalty Sheets HTTP %s (requests)", r.status_code)
        return
    except ImportError:
        pass
    except Exception as e:
        logger.warning("requests Sheets: %s — http.client deneniyor", e)

    import http.client
    import urllib.parse
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": str(len(data)),
        "User-Agent": "PusulabetBot/1.0",
    }
    current = url
    for _ in range(8):
        parsed = urllib.parse.urlparse(current)
        if parsed.scheme == "https":
            conn = http.client.HTTPSConnection(parsed.netloc, timeout=timeout)
        else:
            conn = http.client.HTTPConnection(parsed.netloc, timeout=timeout)
        path = parsed.path or "/"
        if parsed.query:
            path += "?" + parsed.query
        conn.request("POST", path, body=data, headers=headers)
        resp = conn.getresponse()
        code = resp.status
        loc = resp.getheader("Location")
        resp.read()
        conn.close()
        if code in (301, 302, 303, 307, 308) and loc:
            current = urllib.parse.urljoin(current, loc)
            continue
        if code >= 400:
            raise RuntimeError(f"Sheets HTTP {code}")
        logger.info("Penalty Sheets HTTP %s (http.client)", code)
        return


def _send_penalty_result_to_sheets(result_obj: dict) -> bool:
    """Sadece penalty için Google Sheets'e gönderim. True = başarılı."""
    try:
        pb = result_obj.get("pusulabet_kullanici", "") or ""
        body = {
            "game": "penalty",
            "tarih": result_obj.get("tarih"),
            "telegram_kullanici": result_obj.get("telegram_kullanici"),
            "telegram_id": result_obj.get("telegram_id"),
            "pusulabet_kullanici": pb,
            "pusulabet_username": pb,
            "score": result_obj.get("score"),
            "goals": result_obj.get("goals"),
            "won": result_obj.get("won"),
            "kazandi": "EVET" if result_obj.get("won") else "HAYIR",
        }
        _post_json_apps_script(PENALTY_SHEETS_URL, body)
        logger.info(
            "Penalty sonucu Sheets'e gonderildi (goals=%s won=%s)",
            body.get("goals"),
            body.get("won"),
        )
        return True
    except Exception as e:
        logger.warning("Penalty Sheets gonderim hatasi: %s", e)
        return False


async def cmd_liste(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Admin: tüm oyuncu listesini gösterir."""
    if not is_admin(update.effective_user.id):
        await update.message.reply_text("⛔ Bu komut sadece admin içindir.")
        return

    data = load_data()
    players = data.get("players", [])

    if not players:
        await update.message.reply_text("📋 Henüz hiç oyuncu yok.")
        return

    # Benzersiz kullanıcıları say
    unique_ids = set(p["id"] for p in players)

    lines = [f"👥 *Oyuncu Listesi* ({len(players)} oynanış / {len(unique_ids)} benzersiz kişi)\n"]
    for i, p in enumerate(players, 1):
        uname = f"@{p['username']}" if p.get('username') else p.get('name', '?')
        lines.append(f"{i}\. {uname} — `{p.get('time','?')}`")

    # Telegram 4096 karakter limiti — gerekirse böl
    msg = "\n".join(lines)
    if len(msg) > 4000:
        msg = msg[:4000] + "\n\n_(liste kısaltıldı)_"

    await update.message.reply_text(msg, parse_mode="Markdown")


async def cmd_sifirla(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Admin: oyuncu listesini ve sayacı sıfırlar."""
    if not is_admin(update.effective_user.id):
        await update.message.reply_text("⛔ Bu komut sadece admin içindir.")
        return

    data = load_data()
    for gname in data.get("games", {}):
        data["games"][gname]["players"] = []
        data["games"][gname]["total_plays"] = 0
    save_data(data)
    await update.message.reply_text("🗑 *Tüm oyunların listesi ve sayaçları sıfırlandı.*", parse_mode="Markdown")


async def cmd_config(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Admin: mevcut config ayarlarını gösterir."""
    if not is_admin(update.effective_user.id):
        await update.message.reply_text("⛔ Bu komut sadece admin içindir.")
        return
    cfg = load_config()
    text = (
        "⚙️ *Mevcut Ayarlar*\n\n"
        f"*Kanal Başlık:* `{cfg.get('kanal_baslik','')}`\n"
        f"*Kanal Msg 1:* `{cfg.get('channel_msg1','')[:60]}`\n"
        f"*Kanal Msg 2:* `{cfg.get('channel_msg2','')[:60]}`\n"
        f"*Giriş Butonu:* `{cfg.get('giris_btn_text','')}`\n"
        f"*Giriş Linki:* `{cfg.get('giris_btn_link','')}`\n"
        f"*Hoş Geldin Başlık:* `{cfg.get('welcome_title','')}`\n"
        f"*Hoş Geldin Metin:* `{cfg.get('welcome_text','')[:80]}`\n\n"
        "Değiştirmek için:\n"
        "`/set kanal\_baslik Yeni Başlık`\n"
        "`/set channel\_msg1 Yeni mesaj`\n"
        "`/set giris\_btn\_text Giris Yap!`\n"
        "`/set giris\_btn\_link https://...`\n"
        "`/set welcome\_title Merhaba!`\n"
        "`/set welcome\_text Metin buraya`"
    )
    await update.message.reply_text(text, parse_mode="Markdown")


async def cmd_set(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Admin: /set anahtar değer — config ayarı değiştir."""
    if not is_admin(update.effective_user.id):
        await update.message.reply_text("⛔ Bu komut sadece admin içindir.")
        return
    if not ctx.args or len(ctx.args) < 2:
        await update.message.reply_text(
            "❓ Kullanım: `/set anahtar değer`\n\nÖrnek:\n`/set giris\_btn\_text Giriş Yap!`",
            parse_mode="Markdown"
        )
        return
    key = ctx.args[0]
    value = " ".join(ctx.args[1:])
    allowed_keys = [
        "kanal_baslik", "channel_msg1", "channel_msg2",
        "giris_btn_text", "giris_btn_link",
        "welcome_title", "welcome_text"
    ]
    if key not in allowed_keys:
        await update.message.reply_text(
            f"❌ Geçersiz anahtar: `{key}`\n\nGeçerli anahtarlar:\n" +
            "\n".join(f"`{k}`" for k in allowed_keys),
            parse_mode="Markdown"
        )
        return
    cfg = load_config()
    cfg[key] = value
    save_config(cfg)
    logger.info(f"Config güncellendi: {key} = {value}")
    await update.message.reply_text(
        f"✅ *{key}* güncellendi:\n`{value}`",
        parse_mode="Markdown"
    )


async def cmd_sifirla_katilim(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Admin: katılım sınırını sıfırlar (tüm oyuncular tekrar oynayabilir)."""
    if not is_admin(update.effective_user.id):
        await update.message.reply_text("⛔ Bu komut sadece admin içindir.")
        return
    data = load_data()
    for gname in data.get("games", {}):
        data["games"][gname]["players"] = []
        data["games"][gname]["total_plays"] = 0
    save_data(data)
    await update.message.reply_text(
        "✅ *Katılım listesi sıfırlandı!*\n\nTüm kullanıcılar tekrar oynayabilir.",
        parse_mode="Markdown"
    )
    logger.info("Katılım sıfırlandı")


async def cmd_test(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Admin: oyunu test modunda açar — sadece admin görebilir, üyeler göremez."""
    if not is_admin(update.effective_user.id):
        await update.message.reply_text("⛔ Bu komut sadece admin içindir.")
        return

    data = load_data()
    game = get_game(data, "puzzle")
    game["test_mode"] = True   # test bayrağı
    if not game["active"]:
        game["active"] = True
        game["started_at"] = datetime.now().isoformat()
        save_data(data)
        await update.message.reply_text(
            "🧪 *Test modu aktif!*\n\n"
            "Oyun sadece sana açık, üyeler göremez.\n"
            "Tamamladıktan sonra:\n"
            "• Üyelere açmak için /ac puzzle\n"
            "• Kapatmak için /kapat puzzle",
            parse_mode="Markdown",
            reply_markup=game_keyboard("puzzle")
        )
    else:
        save_data(data)
        await update.message.reply_text(
            "🧪 *Test modu aktif!*\n\n"
            "Oyun zaten açıktı, test bayrağı eklendi.\n"
            "Aşağıdan oynayabilirsin 👇",
            parse_mode="Markdown",
            reply_markup=game_keyboard("puzzle")
        )
    logger.info(f"Test modu açıldı — admin: {ADMIN_ID}")


async def cmd_yardim(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    if not is_admin(user.id):
        # Kullanıcılar sadece oyun komutlarını görür
        await update.message.reply_text(
            "🧩 *Pusulabet Puzzle Bot*\n\n"
            "*/oyna* — Puzzle oyununu başlat\n"
            "*/penalti* — Penaltı oyununu başlat\n"
            "*/start* — Başlangıç mesajı\n",
            parse_mode="Markdown"
        )
        return

    await update.message.reply_text(
        "🧩 *Pusulabet Puzzle Bot — Admin Paneli*\n\n"
        "👤 *Kullanıcı Komutları:*\n"
        "*/start* — Başlangıç mesajı\n"
        "*/oyna* — Puzzle oyununu başlat\n\n"
        "*/penalti* — Penaltı oyununu başlat\n\n"
        "👑 *Admin Komutları:*\n"
        "*/ac* `puzzle|penalty` — Oyunu aktif et\n"
        "*/kapat* `puzzle|penalty` — Oyunu kapat\n"
        "*/test* — Sadece sana açık test modu\n"
        "*/kanal* — Kanala paylaş\n"
        "*/durum* — İstatistikler\n"
        "*/liste* — Oyuncu listesi\n"
        "*/sifirla* — Sayaçları sıfırla\n"
        "*/sifirla\_katilim* — Katılım sınırını sıfırla\n"
        "*/config* — Mevcut ayarları gör\n"
        "*/set* `anahtar değer` — Ayar değiştir\n"
        "*/yardim* — Bu mesaj\n",
        parse_mode="Markdown"
    )


# ── Ana Fonksiyon ─────────────────────────────────────────────────────────────
import asyncio
import sys


# ── Admin API Server ──────────────────────────────────────────────────────────
class AdminAPIHandler(BaseHTTPRequestHandler):
    """Admin panelinden gelen istekleri karşılar."""

    def log_message(self, format, *args):
        pass  # HTTP logları sustur

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key')
        self.end_headers()

    def check_auth(self):
        key = self.headers.get('X-Admin-Key', '')
        return key == 'pusula-admin-2024'

    def do_GET(self):
        if not self.check_auth():
            self.send_json({'error': 'Unauthorized'}, 401); return

        parsed = urlparse(self.path)
        path = parsed.path

        if path == '/api/status':
            data = load_data()
            games = data.get('games', {})
            result = {}
            for gname, gdata in games.items():
                players = gdata.get('players', [])
                unique = len(set(p['id'] for p in players))
                result[gname] = {
                    'active': gdata.get('active', False),
                    'total_plays': gdata.get('total_plays', 0),
                    'unique_players': unique,
                    'started_at': gdata.get('started_at')
                }
            self.send_json({'ok': True, 'games': result})

        elif path == '/api/ping':
            self.send_json({'ok': True, 'bot': 'Pusulabet'})
        else:
            self.send_json({'error': 'Not found'}, 404)

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        parsed = urlparse(self.path)
        path = parsed.path
        try:
            body = json.loads(self.rfile.read(length)) if length else {}
        except Exception as e:
            logger.warning("Admin API JSON parse error path=%s err=%s", path, e)
            body = {}

        # /api/result: Mini App fallback (auth yok)
        if path != '/api/result':
            if not self.check_auth():
                self.send_json({'error': 'Unauthorized'}, 401)
                return

        if path == '/api/game/toggle':
            game_name = body.get('game', 'puzzle')
            active = body.get('active', False)
            data = load_data()
            game = get_game(data, game_name)
            game['active'] = active
            if active:
                game['started_at'] = datetime.now().isoformat()
            save_data(data)
            status = 'AKTİF' if active else 'KAPALI'
            logger.info(f"Admin panel: {game_name} {status}")
            self.send_json({'ok': True, 'game': game_name, 'active': active})

        elif path == '/api/reset':
            data = load_data()
            for gname in data.get('games', {}):
                data['games'][gname]['players'] = []
                data['games'][gname]['total_plays'] = 0
            save_data(data)
            logger.info("Admin panel: istatistikler sıfırlandı")
            self.send_json({'ok': True, 'message': 'Sıfırlandı'})

        elif path == '/api/result':
            # Telegram yoksa frontend buraya POST atar
            payload = body if isinstance(body, dict) else {}
            logger.info("api/result payload=%s", json.dumps(payload, ensure_ascii=False)[:2000])
            try:
                data_store = load_data()
                # telegram_id payload içinde yoksa boş kalır
                result_obj = _record_penalty_result(
                    payload=payload,
                    data_store=data_store,
                    telegram_id=str(payload.get("telegram_id") or ""),
                    telegram_username=str(payload.get("telegram_kullanici") or ""),
                    source="http",
                )
                self.send_json({'ok': True, 'result': result_obj})
            except PenaltyDuplicateError:
                self.send_json(
                    {
                        'ok': False,
                        'error': 'duplicate',
                        'message': 'Bu Telegram hesabıyla zaten katılım yapıldı.',
                    },
                    403,
                )
            except PenaltyPusulabetRequiredError:
                self.send_json(
                    {
                        'ok': False,
                        'error': 'pusulabet_required',
                        'message': 'Pusulabet kullanıcı adı gerekli.',
                    },
                    400,
                )
            except Exception as e:
                logger.exception("api/result error: %s", e)
                self.send_json({'ok': False, 'error': str(e)}, 500)

        else:
            self.send_json({'error': 'Not found'}, 404)

def start_admin_server():
    server = HTTPServer(('0.0.0.0', 8484), AdminAPIHandler)
    logger.info("🌐 Admin API: http://localhost:8484")
    server.serve_forever()

async def main():
    if not BOT_TOKEN:
        logger.error("BOT_TOKEN yok. Proje kökünde .env dosyasına BOT_TOKEN=... ekleyin.")
        sys.exit(1)
    app = Application.builder().token(BOT_TOKEN).build()

    # Komut handler'ları
    app.add_handler(CommandHandler("start",   cmd_start))
    app.add_handler(CommandHandler("oyna",    cmd_oyna))
    app.add_handler(CommandHandler(["penalti", "penalty"], cmd_penalti))
    app.add_handler(CommandHandler("kanal",   cmd_kanal))
    app.add_handler(CommandHandler("ac",      cmd_ac))
    app.add_handler(CommandHandler("kapat",   cmd_kapat))
    app.add_handler(CommandHandler("test",    cmd_test))
    app.add_handler(CommandHandler("durum",   cmd_durum))
    app.add_handler(CommandHandler("liste",   cmd_liste))
    app.add_handler(CommandHandler("sifirla", cmd_sifirla))
    app.add_handler(CommandHandler("config",  cmd_config))
    app.add_handler(CommandHandler("set",     cmd_set))
    app.add_handler(CommandHandler("sifirla_katilim", cmd_sifirla_katilim))
    app.add_handler(CommandHandler("yardim",  cmd_yardim))

    # Callback handler'ları
    app.add_handler(CallbackQueryHandler(callback_share, pattern="^share:"))
    app.add_handler(
        MessageHandler(filters.StatusUpdate.WEB_APP_DATA, handle_webapp_data),
        group=-1,
    )

    # Admin API server'ı ayrı thread'de başlat
    admin_thread = threading.Thread(target=start_admin_server, daemon=True)
    admin_thread.start()

    logger.info("🤖 Pusulabet Bot başlatılıyor...")

    async with app:
        await app.start()
        await app.updater.start_polling(drop_pending_updates=True)
        logger.info("✅ Bot çalışıyor! Durdurmak için CTRL+C")
        await asyncio.Event().wait()  # sonsuza kadar çalış

if __name__ == "__main__":
    asyncio.run(main())
