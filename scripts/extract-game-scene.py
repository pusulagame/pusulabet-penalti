# -*- coding: utf-8 -*-
"""index.html içindeki module script'i game-scene.js'e dönüştürür."""
from pathlib import Path

root = Path(__file__).resolve().parent.parent
html = (root / "index.html").read_text(encoding="utf-8")
start = html.find('<script type="module">')
end = html.rfind("</script>")
block = html[start : html.find("</script>", start) + len("</script>")]
# strip outer script tag
inner = block.replace('<script type="module">', "", 1).rsplit("</script>", 1)[0].strip()

header = '''import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { sendPenaltyResult } from '../services/result-sender.js';
import { store } from '../state/store.js';
import { getTgId, isPenaltyLocked } from '../services/telegram.js';

const BASE = new URL('../assets/', import.meta.url).href;
const ASSET = (p) => new URL(p, BASE).href;

let strikerIdleRel = 'players/onuachu/onuachu_idle.fbx';
let strikerKickRel = 'players/onuachu/onuachu_kick.fbx';

export function setStrikerAssets(idleRel, kickRel) {
  strikerIdleRel = idleRel;
  strikerKickRel = kickRel;
}

export async function runPenaltyGame() {
  await boot();
}

'''

# Remove old inline imports (first 3 lines typically)
lines = inner.splitlines()
out_lines = []
skip = 0
for i, line in enumerate(lines):
    if skip:
        skip -= 1
        continue
    if line.strip().startswith("import * as THREE"):
        skip = 2  # skip three lines of import
        continue
    out_lines.append(line)

body = "\n".join(out_lines)

# Renames
body = body.replace("let arda=", "let striker=")
body = body.replace("arda.", "striker.")
body = body.replace("(arda,", "(striker,")
body = body.replace("playAnim(arda", "playAnim(striker")
body = body.replace("tickChar(arda", "tickChar(striker")
body = body.replace("normalizeChar(ardaIdle", "normalizeChar(strikerIdle")
body = body.replace("normalizeChar(ardaKick", "normalizeChar(strikerKick")
body = body.replace("ardaIdle", "strikerIdle")
body = body.replace("ardaKick", "strikerKick")
body = body.replace("arda={", "striker={")
body = body.replace("console.log('[Arda]", "console.log('[Striker]")
body = body.replace("// ── ARDA FBX ──", "// ── STRIKER FBX ──")

# Remove telegram / sheets / pb block from original (lines 219-275 approx) - we do manually if still there

# Replace ASSET line - already have BASE at top
body = body.replace(
    "const BASE = new URL('assets/', new URL('.', import.meta.url)).href;\nconst ASSET = (p)=>new URL(p, BASE).href;",
    "// BASE/ASSET from module scope",
)

# Fix duplicate BASE if comment left wrong
if "const BASE = new URL('assets/'" in body:
    body = body.split("const BASE = new URL('assets/'")[0] + body.split("const ASSET = (p)=>new URL(p, BASE).href;", 1)[-1]
    if body.startswith("\n"):
        body = body.lstrip("\n")

# boot(): replace striker fbx paths
old_block = """  const [strikerIdle, strikerKick] = await Promise.all([
    loadFBX(ASSET('arda/idle.fbx')),
    loadFBX(ASSET('arda/kick.fbx')),
  ]);"""

new_block = """  const [strikerIdle, strikerKick] = await Promise.all([
    loadFBX(ASSET(strikerIdleRel)),
    loadFBX(ASSET(strikerKickRel)),
  ]);"""

if old_block in body:
    body = body.replace(old_block, new_block)
else:
    # fallback search
    import re
    body = re.sub(
        r"loadFBX\(ASSET\('arda/idle\.fbx'\)\),\s*loadFBX\(ASSET\('arda/kick\.fbx'\)\)",
        "loadFBX(ASSET(strikerIdleRel)), loadFBX(ASSET(strikerKickRel))",
        body,
    )

# Remove PENALTY_SHEETS_URL and tg init and pb helpers from body if present - strip large blocks
import re

def strip_between(text, start_marker, end_marker):
    a = text.find(start_marker)
    if a == -1:
        return text
    b = text.find(end_marker, a)
    if b == -1:
        return text
    return text[:a] + text[b:]

# Remove duplicate telegram block at start of old script (after THREE setup)
markers = [
    ("// ── TELEGRAM ──", "// ── LOADING UI"),
]
for sm, em in markers:
    if sm in body and em in body:
        a = body.find(sm)
        b = body.find(em, a)
        if a != -1 and b != -1:
            body = body[:a] + body[b:]

# Remove pb / btnStart loading coupling - simplify setLoadProgress for no btnStart
body = body.replace(
    """// ── LOADING UI (progress bar) ──
const ld=document.getElementById('loading');
const ldFill=document.getElementById('ldFill');
const ldPct=document.getElementById('ldPct');
const btnStart=document.getElementById('btnStart');
const pbUserEl=document.getElementById('pbUser');
const pbErrEl=document.getElementById('pbErr');
const PB_USER_KEY='pusulabet_username';
let pusulabetUsername='';

function normPbUser(v){
  return (v||'').trim().replace(/\\s+/g,' ').slice(0,24);
}
function setPbError(msg){
  if(pbErrEl) pbErrEl.textContent = msg || '';
}
function readPbUser(){
  const v = pbUserEl ? pbUserEl.value : '';
  return normPbUser(v);
}
function loadPbUser(){
  try{
    pusulabetUsername = normPbUser(localStorage.getItem(PB_USER_KEY) || '');
  }catch(e){
    pusulabetUsername = '';
  }
  if(pbUserEl) pbUserEl.value = pusulabetUsername;
}
function persistPbUser(v){
  pusulabetUsername = normPbUser(v);
  try{ localStorage.setItem(PB_USER_KEY, pusulabetUsername); }catch(e){}
}
function getTgId(){ return String(tg?.initDataUnsafe?.user?.id || ''); }
function isPenaltyLocked(){
  const id = getTgId();
  if(!id) return false;
  try{ return localStorage.getItem('penalty_done_'+id)==='1'; }catch(e){ return false; }
}
function applyPenaltyLockUI(){
  if(!isPenaltyLocked()) return;
  if(btnStart){
    btnStart.disabled=true;
    btnStart.style.opacity='0.55';
    btnStart.textContent='KATILIM TAMAMLANDI';
  }
  if(pbUserEl) pbUserEl.disabled=true;
  setPbError('Bu Telegram hesabıyla zaten katıldın.');
}
loadPbUser();
applyPenaltyLockUI();
if(btnStart){
  btnStart.disabled=true;
  btnStart.style.opacity='0.65';
  btnStart.textContent='YÜKLENİYOR...';
}

""",
    """// ── LOADING UI (progress bar) ──
const ld=document.getElementById('loading');
const ldFill=document.getElementById('ldFill');
const ldPct=document.getElementById('ldPct');

""",
)

# Fix setLoadProgress - remove btnStart branches
body = body.replace(
    """function setLoadProgress(p){
  const pct=Math.round(clamp(p,0,1)*100);
  if(ldPct) ldPct.textContent=pct+'%';
  if(ldFill) ldFill.style.width=pct+'%';
  if(btnStart) btnStart.textContent = pct>=100 ? '⚽ BASLAT' : ('YÜKLENİYOR... '+pct+'%');
  if(pct>=100){
    if(btnStart){
      if(isPenaltyLocked()){
        btnStart.disabled=true;
        btnStart.style.opacity='0.55';
        btnStart.textContent='KATILIM TAMAMLANDI';
      }else{
        btnStart.disabled=false;
        btnStart.style.opacity='';
        btnStart.textContent='⚽ BASLAT';
      }
    }
    if(ld) ld.classList.add('hide');
  }
}""",
    """function setLoadProgress(p){
  const pct=Math.round(clamp(p,0,1)*100);
  if(ldPct) ldPct.textContent=pct+'%';
  if(ldFill) ldFill.style.width=pct+'%';
  if(pct>=100){
    if(ld) ld.classList.add('hide');
  }
}""",
)

# Replace showFinal payload with sendPenaltyResult call
old_show = """  const payload = JSON.stringify({
    game: 'penalty',
    pusulabet_username: (pusulabetUsername || '').trim(),
    telegram_id: tgId,
    telegram_kullanici: tgName,
    score,
    goals: goalsHud,
    won,
    kazandi: won ? 'EVET' : 'HAYIR',
    total: TOTAL
  });

  const btnReplay=document.querySelector('#final .btnP');
  if(btnReplay && tgId){ btnReplay.style.display='none'; }

  // 1) sendData ile bot'a gönder
  if(tg && tg.sendData){
    try{
      tg.sendData(payload);
      console.log('[sendData] gönderildi');
    }catch(e){
      console.warn('[sendData] hata:', e);
    }
  }

  // 2) Kazananları Google Sheets'e gönder (GET ile — en güvenilir yöntem)
  if(won){
    const p = JSON.parse(payload);
    const qs = new URLSearchParams({
      game: 'penalty',
      tarih: p.tarih || new Date().toLocaleString('tr-TR'),
      telegram_kullanici: p.telegram_kullanici || '',
      telegram_id: p.telegram_id || '',
      pusulabet_username: p.pusulabet_username || '',
      score: p.score || '',
      goals: String(p.goals || 0),
      kazandi: 'EVET'
    });
    const url = PENALTY_SHEETS_URL + '?' + qs.toString();
    try{
      fetch(url, { mode: 'no-cors', cache: 'no-store' }).catch(()=>{});
      (new Image()).src = url;
    }catch(e){ console.warn('[sheets]', e); }
  }
}"""

new_show = """  sendPenaltyResult({
    goals: goalsHud,
    won,
    score,
    goalsHud,
    total: TOTAL,
  });

  const btnReplay=document.querySelector('#final .btnP');
  if(btnReplay && getTgId()){ btnReplay.style.display='none'; }
}"""

if old_show in body:
    body = body.replace(old_show, new_show)
else:
    print("WARN: showFinal block not found verbatim")

# Remove startGame and btnStart listener at end
body = re.sub(
    r"function startGame\(\)\{document\.getElementById\('start'\)\.style\.display='none';gameActive=true;canShoot=true;\}\s*window\.startGame=startGame;\s*document\.getElementById\('btnStart'\)\?\.addEventListener\('click',[\s\S]*?\}\);\s*",
    "",
    body,
)

# Remove buildDots request before boot at end - keep one buildDots
body = body.replace("buildDots();\nrequestAnimationFrame(loop);\nboot();", "buildDots();\nrequestAnimationFrame(loop);\n")

# boot() is now only called via runPenaltyGame

out = header + "\n" + body

out_path = root / "scenes" / "game-scene.js"
out_path.write_text(out, encoding="utf-8")
print("Wrote", out_path, "len", len(out))
