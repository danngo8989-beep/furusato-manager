"use strict";
/* app.js — ストレージ層・集計・UI */
/* ===== ストレージ層 ===== */const STORE_KEY = "furusato-manager-v1";
const SCHEMA_VERSION = 1;
function localToday(){
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
}
function emptyYear(){
  return { income:null, family:"single", limitEstimate:null, limitManual:null, donations:[] };
}
function defaultState(){
  const y = new Date().getFullYear();
  return { version:SCHEMA_VERSION, activeYear:y, years:{ [y]: emptyYear() } };
}
function migrate(data){
  if (typeof data.version !== "number") data.version = 1;
  /* 将来: if (data.version < 2){ ... ; data.version = 2; } */
  return data;
}
function isValidState(d){
  return d && typeof d === "object" && d.years && typeof d.years === "object"
    && Number.isInteger(d.activeYear);
}
let state;
let storageBroken = false;
function load(){
  try{
    const raw = localStorage.getItem(STORE_KEY);
    if (raw){
      const d = migrate(JSON.parse(raw));
      if (isValidState(d)) { state = d; return; }
    }
  }catch(e){ /* 壊れたデータ・アクセス不可 → 初期化 */ }
  state = defaultState();
}
function save(){
  try{
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    storageBroken = false;
  }catch(e){
    if (!storageBroken){
      storageBroken = true;
      toast("保存に失敗しました（プライベートモード等）。エクスポートで控えを取ってください");
    }
  }
}
function year(){
  const y = state.activeYear;
  if (!state.years[y]) state.years[y] = emptyYear();
  return state.years[y];
}
function currentLimit(){
  const yd = year();
  return yd.limitManual != null ? yd.limitManual : yd.limitEstimate;
}
function uid(){
  return (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2));
}
const yen = n => "¥" + Math.round(n).toLocaleString("ja-JP");

/* ===== 集計（純関数） ===== */
function totals(donations){
  const sum = donations.reduce((s,d)=>s + (Number(d.amount)||0), 0);
  const cities = new Set(donations.map(d=>(d.city||"").trim()).filter(Boolean));
  const unsent = donations.filter(d=>!d.onestopSent).length;
  return { sum, cityCount: cities.size, unsent };
}

/* ===== DOM ===== */
const $ = id => document.getElementById(id);
let toastTimer;
function toast(msg){
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove("show"), 2600);
}

function renderHero(){
  const yd = year();
  const limit = currentLimit();
  const { sum } = totals(yd.donations);
  const big = $("heroAmount"), bar = $("heroBar");
  if (limit == null){
    $("heroLabel").textContent = "今年の寄付合計";
    big.textContent = yen(sum);
    big.classList.remove("over");
    bar.style.width = "0%";
    bar.classList.remove("over");
    $("heroCaption").textContent = "上限が未設定です";
    $("heroCta").hidden = false;
    if (!$("limitDetails").open) $("limitDetails").open = true;
    return;
  }
  $("heroCta").hidden = true;
  const remain = limit - sum;
  const over = remain < 0;
  $("heroLabel").textContent = over ? "上限を超過しています" : "のこり寄付枠（目安）";
  big.textContent = over ? "超過 " + yen(-remain) : yen(remain);
  big.classList.toggle("over", over);
  bar.style.width = Math.min(100, limit > 0 ? sum/limit*100 : 100) + "%";
  bar.classList.toggle("over", over);
  const src = yd.limitManual != null ? "手動" : "目安";
  $("heroCaption").textContent = "上限（" + src + "） " + yen(limit) + " ・ 寄付済 " + yen(sum);
}

function renderList(){
  const yd = year();
  const ul = $("donationList");
  ul.textContent = "";
  const list = yd.donations.slice().sort((a,b)=> (b.date||"").localeCompare(a.date||""));
  $("listEmpty").hidden = list.length > 0;
  $("listTitle").textContent = "寄付一覧（" + list.length + "件）";
  for (const d of list){
    const li = document.createElement("li");
    const main = document.createElement("div"); main.className = "d-main";
    const city = document.createElement("div"); city.className = "d-city"; city.textContent = d.city || "（自治体名なし）";
    const sub = document.createElement("div"); sub.className = "d-sub";
    sub.textContent = (d.date || "") + (d.item ? " ・ " + d.item : "");
    main.append(city, sub);
    const amt = document.createElement("div"); amt.className = "d-amt"; amt.textContent = yen(Number(d.amount)||0);
    const pill = document.createElement("button");
    pill.className = "pill" + (d.onestopSent ? " sent" : "");
    pill.textContent = d.onestopSent ? "申請済" : "未申請";
    pill.setAttribute("aria-label", "ワンストップ申請書の提出状態を切り替え");
    pill.addEventListener("click", ()=>{ d.onestopSent = !d.onestopSent; save(); render(); });
    const del = document.createElement("button");
    del.className = "del"; del.textContent = "×"; del.setAttribute("aria-label","この寄付を削除");
    del.addEventListener("click", ()=>{
      if (confirm((d.city||"この寄付") + " " + yen(Number(d.amount)||0) + " を削除しますか？")){
        yd.donations = yd.donations.filter(x=>x.id !== d.id);
        save(); render();
      }
    });
    li.append(main, amt, pill, del);
    ul.appendChild(li);
  }
}

function renderOnestop(){
  const yd = year();
  const { cityCount, unsent } = totals(yd.donations);
  const box = $("onestopStatus");
  box.textContent = "";
  const div = document.createElement("div");
  if (cityCount > 5){
    div.className = "status warn";
    div.textContent = "寄付先が6自治体以上のため、ワンストップ特例は使えません。確定申告で寄附金控除を申告してください。";
  } else if (unsent > 0){
    div.className = "status warn";
    div.textContent = "申請書が未提出の寄付が " + unsent + " 件あります。";
  } else {
    div.className = "status ok";
    div.textContent = yd.donations.length ? "すべての寄付で申請書を提出済みです。" : "寄付を記録するとここでチェックできます。";
  }
  box.appendChild(div);
  $("cityCount").textContent = cityCount + " / 5";
  $("unsentCount").textContent = unsent + "件";
  $("deadline").textContent = (state.activeYear + 1) + "年1月10日 必着";
}

function renderInputs(){
  const yd = year();
  $("yearLabel").textContent = state.activeYear + "年";
  $("income").value = yd.income != null ? yd.income : "";
  $("family").value = yd.family || "single";
  $("manualLimit").value = yd.limitManual != null ? yd.limitManual : "";
  const dd = $("dDate");
  const t = localToday();
  dd.value = t.startsWith(String(state.activeYear)) ? t : state.activeYear + "-01-01";
}

function render(){
  renderHero(); renderList(); renderOnestop();
}

/* ===== イベント ===== */
function init(){
  load();
  renderInputs(); render();

  $("prevYear").addEventListener("click", ()=>{ changeYear(-1); });
  $("nextYear").addEventListener("click", ()=>{ changeYear(1); });
  function changeYear(d){
    const y = state.activeYear + d;
    if (y < 2020 || y > 2100) return;
    state.activeYear = y; save(); renderInputs(); render();
  }

  $("calcBtn").addEventListener("click", ()=>{
    const yd = year();
    const income = parseFloat($("income").value);
    const fam = $("family").value;
    const out = $("calcResult");
    out.hidden = false;
    if (!isFinite(income) || income <= 0){
      out.className = "result err";
      out.textContent = "年収を万円単位で入力してください（例: 500）";
      return;
    }
    const r = estimateLimit(income, fam);
    if (r.error){
      out.className = "result err";
      out.textContent = r.error === "low"
        ? "年収300万円未満は早見表の範囲外です。上限はごく少額になる可能性が高いため、ポータルの詳細シミュレーションをご利用ください。"
        : "この条件では早見表に目安がありません（自己負担2,000円で収まる枠がほぼない可能性）。詳細シミュレーションをご確認ください。";
      yd.income = income; yd.family = fam; yd.limitEstimate = null;
      save(); render();
      return;
    }
    yd.income = income; yd.family = fam; yd.limitEstimate = r.value;
    save(); render();
    out.className = "result";
    out.textContent = "";
    const s = document.createElement("span");
    s.append("上限の目安: ");
    const strong = document.createElement("strong");
    strong.textContent = yen(r.value);
    s.append(strong);
    s.append(r.clamped ? "（年収2,500万円として計算）" : "");
    const note = document.createElement("div");
    note.className = "note";
    note.textContent = FAMILY_LABELS[fam] + " ・ 年収" + income.toLocaleString("ja-JP") + "万円の概算。この金額を上限として残枠を表示します。";
    out.append(s, note);
  });

  $("manualBtn").addEventListener("click", ()=>{
    const yd = year();
    const v = $("manualLimit").value.trim();
    if (v === ""){
      yd.limitManual = null; save(); render();
      toast("手動上限を解除しました（目安計算を使用）");
      return;
    }
    const n = Math.floor(Number(v));
    if (!isFinite(n) || n < 0 || n > 100000000){
      toast("0〜1億円の範囲で入力してください");
      return;
    }
    yd.limitManual = n; save(); render();
    toast("上限を " + yen(n) + " に設定しました");
  });

  $("addBtn").addEventListener("click", ()=>{
    const yd = year();
    const city = $("dCity").value.trim();
    const amount = Math.floor(Number($("dAmount").value));
    const date = $("dDate").value || localToday();
    if (!city){ toast("自治体名を入力してください"); $("dCity").focus(); return; }
    if (!isFinite(amount) || amount <= 0 || amount > 100000000){ toast("金額を1円以上で入力してください"); $("dAmount").focus(); return; }
    yd.donations.push({
      id: uid(), date, city,
      amount, item: $("dItem").value.trim(),
      onestopSent: $("dOnestop").checked
    });
    save(); render();
    $("dCity").value = ""; $("dAmount").value = ""; $("dItem").value = ""; $("dOnestop").checked = false;
    toast(city + " " + yen(amount) + " を記録しました");
  });

  $("exportBtn").addEventListener("click", ()=>{
    $("exportArea").value = JSON.stringify(state);
    $("exportArea").focus();
    $("exportArea").select();
    toast("全文をコピーしてメモ等に保存してください");
  });

  $("importBtn").addEventListener("click", ()=>{
    const raw = $("importArea").value.trim();
    if (!raw){ toast("エクスポート文字列を貼り付けてください"); return; }
    let d;
    try{ d = migrate(JSON.parse(raw)); }
    catch(e){ toast("読み込めませんでした。エクスポート文字列をそのまま貼り付けてください"); return; }
    if (!isValidState(d)){ toast("データ形式が正しくありません"); return; }
    if (!confirm("現在のデータをインポート内容で置き換えます。よろしいですか？")) return;
    state = d; save();
    renderInputs(); render();
    $("importArea").value = "";
    toast("インポートしました");
  });

  $("wipeBtn").addEventListener("click", ()=>{
    if (!confirm("全データを削除します。エクスポートで控えを取りましたか？")) return;
    if (!confirm("本当に削除してよろしいですか？この操作は取り消せません。")) return;
    state = defaultState();
    try{ localStorage.removeItem(STORE_KEY); }catch(e){}
    save(); renderInputs(); render();
    $("exportArea").value = ""; $("importArea").value = "";
    toast("全データを削除しました");
  });
}
init();
