const API_URL = 'https://script.google.com/macros/s/AKfycbxeZbEGVshSmWJYJoAa5hLeAoUp_IZWk0AehcJ--eF3xlJKAlxZy7nFY_6UcZcE15dX/exec';
const RESTAURANT = '海風餐廳';
const $ = id => document.getElementById(id);
const storage = localStorage;
let key = '';
let busy = false;
let generation = 0;
let saved = JSON.parse(storage.getItem('waitlist-ticket') || 'null');
let pendingToken = '';
const staff = Boolean($('login'));

async function api(action, data = {}) {
  const request = {action, ...data};
  if (!API_URL) return demo(request);
  const response = await fetch(API_URL, {method:'POST', body:JSON.stringify(request)});
  if (!response.ok) throw new Error('連線失敗');
  const result = await response.json();
  if (result.error) throw new Error(result.error);
  return result;
}

function demo(d) {
  const state = JSON.parse(storage.getItem('waitlist-demo') || '{"next":1,"queue":[]}');
  const {queue} = state;
  const index = queue.findIndex(t => t.id === Number(d.id));
  const ticket = queue[index];
  const save = () => storage.setItem('waitlist-demo', JSON.stringify(state));
  const status = (t, i) => ({id:t.id, token:t.token, status:t.status, ahead:i,
    waiting:queue.length, party_size:t.party_size});
  if (d.action === 'count') return {waiting:queue.length};
  if (d.action === 'status') {
    return ticket && ticket.token === d.token ? status(ticket, index) : {waiting:queue.length,status:'closed'};
  }
  if (d.action === 'join') {
    const prior = queue.findIndex(t => t.token === d.token);
    if (prior >= 0) return status(queue[prior], prior);
    const {name, gender, email, party_size, token} = d;
    const entry = {id:state.next, name, gender, email, party_size:Number(party_size), token,
      status:'waiting', created_at:new Date().toISOString(), notified_at:''};
    queue.push(entry);
    if (new TextEncoder().encode(JSON.stringify(queue)).length > 8900) throw new Error('候位已滿');
    state.next++;
    save();
    return status(entry, queue.length - 1);
  }
  if (d.key !== 'staff') throw new Error('員工密碼錯誤');
  if (d.action === 'queue') return {queue};
  if (!ticket) throw new Error('這組已離開候位隊伍');
  if (d.action === 'notify') {
    if (ticket.status !== 'notified') {
      ticket.status = 'notified';
      ticket.notified_at = new Date().toISOString();
    }
  } else {
    queue.splice(index, 1);
  }
  save();
  return {ok:true};
}

function showTicket(data) {
  $('count').textContent = data.waiting;
  if (data.status === 'closed') {
    saved = null;
    storage.removeItem('waitlist-ticket');
    $('message').textContent = '這張候位票已結束。';
  }
  $('join').hidden = Boolean(saved);
  $('ticket').hidden = !saved;
  if (!saved) return;
  $('number').textContent = String(data.id).padStart(3, '0');
  $('ahead').textContent = data.ahead;
  $('party').textContent = data.party_size;
  $('status').textContent = data.status === 'notified' ? '已通知，請至櫃台報到' : '等候中';
}

function showQueue({queue}) {
  $('login').hidden = true;
  $('dashboard').hidden = false;
  $('count').textContent = queue.length;
  $('empty').hidden = queue.length > 0;
  $('rows').replaceChildren(...queue.map(t => {
    const row = document.createElement('tr');
    for (const value of [t.id, t.name, t.gender, t.email, t.party_size,
      t.status === 'notified' ? '已通知' : '等候中', new Date(t.created_at).toLocaleString('zh-TW')]) {
      const cell = row.insertCell();
      cell.textContent = value;
    }
    const actions = row.insertCell();
    for (const [action, label] of [['notify','通知'],['seat','入座'],['cancel','取消']]) {
      const button = document.createElement('button');
      button.textContent = label;
      button.disabled = action === 'notify' && t.status === 'notified';
      button.onclick = () => {
        if (busy || (action === 'cancel' && !confirm('確定取消這組候位？'))) return;
        perform(async () => {
          await api(action, {key, id:t.id});
          $('message').textContent = action === 'notify' && !API_URL ? '已模擬通知。' : label + '完成。';
          showQueue(await api('queue', {key}));
        });
      };
      actions.append(button);
    }
    return row;
  }));
}

async function perform(work, form) {
  if (busy) return;
  busy = true;
  generation++;
  const submit = form?.querySelector('button');
  if (submit) submit.disabled = true;
  $('message').textContent = '';
  try {
    await work();
  } catch (error) {
    $('message').textContent = error.message;
  } finally {
    busy = false;
    if (submit) submit.disabled = false;
  }
}

async function refresh() {
  if (busy || (staff && !key)) return;
  const version = ++generation;
  try {
    const result = staff ? await api('queue', {key}) :
      saved ? await api('status', saved) : await api('count');
    if (version === generation) (staff ? showQueue : showTicket)(result);
  } catch (error) {
    if (version === generation) $('message').textContent = error.message;
  }
}

$('restaurant').textContent = RESTAURANT;
$('mode').textContent = API_URL ? '線上候位' : '示範模式 · 資料保存在此瀏覽器 · 不寄信';
if (staff) {
  $('login').onsubmit = event => {
    event.preventDefault();
    perform(async () => {
      const candidate = $('password').value;
      const queue = await api('queue', {key:candidate});
      key = candidate;
      $('password').value = '';
      showQueue(queue);
    }, $('login'));
  };
  $('logout').onclick = () => {
    if (busy) return;
    generation++;
    key = '';
    $('rows').replaceChildren();
    $('dashboard').hidden = true;
    $('login').hidden = false;
    $('message').textContent = '';
    $('password').focus();
  };
} else {
  $('join').onsubmit = event => {
    event.preventDefault();
    perform(async () => {
      const data = Object.fromEntries(new FormData($('join')));
      data.name = data.name.trim();
      if (!data.name) throw new Error('請輸入姓名');
      pendingToken ||= Array.from(crypto.getRandomValues(new Uint8Array(16)),
        byte => byte.toString(16).padStart(2, '0')).join('');
      const result = await api('join', {...data, token:pendingToken});
      saved = {id:result.id, token:result.token};
      storage.setItem('waitlist-ticket', JSON.stringify(saved));
      pendingToken = '';
      $('join').reset();
      showTicket(result);
    }, $('join'));
  };
}
refresh();
setInterval(refresh, 5000);


