/**
 * 語彙カウントの正規化(レンマ化)。
 *
 * 要件定義書 6章「語彙カウントの正規化方式」に基づく実装:
 * go/goes/going/went のような活用形は同一語彙(レンマ)として1つに数える。
 *
 * MVPでは軽量な方式(不規則活用の辞書 + 規則活用の接尾辞除去によるルールベースのレンマ化)
 * で開始し、精度が不足する場合に wink-lemmatizer 等の軽量ライブラリへの切り替えを検討する
 * (要件定義書 6章より)。子供の初期語彙は限定的なため、このレベルの精度でMVPとしては十分と
 * 判断している。
 */

// 不規則動詞・不規則名詞・be動詞など、活用形からレンマへの直接マッピング。
// 「今日は何をした?」への回答で子供が使いそうな基本動詞を中心にカバーする。
const IRREGULAR_LEMMAS: Record<string, string> = {
  // be
  am: 'be', is: 'be', are: 'be', was: 'be', were: 'be', been: 'be', being: 'be',
  // have
  have: 'have', has: 'have', had: 'have', having: 'have',
  // do
  do: 'do', does: 'do', did: 'do', doing: 'do', done: 'do',
  // go
  go: 'go', goes: 'go', going: 'go', went: 'go', gone: 'go',
  // eat
  eat: 'eat', eats: 'eat', eating: 'eat', ate: 'eat', eaten: 'eat',
  // see
  see: 'see', sees: 'see', seeing: 'see', saw: 'see', seen: 'see',
  // make
  make: 'make', makes: 'make', making: 'make', made: 'make',
  // get
  get: 'get', gets: 'get', getting: 'get', got: 'get', gotten: 'get',
  // run
  run: 'run', runs: 'run', running: 'run', ran: 'run',
  // swim
  swim: 'swim', swims: 'swim', swimming: 'swim', swam: 'swim', swum: 'swim',
  // write
  write: 'write', writes: 'write', writing: 'write', wrote: 'write', written: 'write',
  // buy
  buy: 'buy', buys: 'buy', buying: 'buy', bought: 'buy',
  // bring
  bring: 'bring', brings: 'bring', bringing: 'bring', brought: 'bring',
  // think
  think: 'think', thinks: 'think', thinking: 'think', thought: 'think',
  // catch
  catch: 'catch', catches: 'catch', catching: 'catch', caught: 'catch',
  // teach
  teach: 'teach', teaches: 'teach', teaching: 'teach', taught: 'teach',
  // feel
  feel: 'feel', feels: 'feel', feeling: 'feel', felt: 'feel',
  // find
  find: 'find', finds: 'find', finding: 'find', found: 'find',
  // give
  give: 'give', gives: 'give', giving: 'give', gave: 'give', given: 'give',
  // take
  take: 'take', takes: 'take', taking: 'take', took: 'take', taken: 'take',
  // come
  come: 'come', comes: 'come', coming: 'come', came: 'come',
  // drink
  drink: 'drink', drinks: 'drink', drinking: 'drink', drank: 'drink', drunk: 'drink',
  // fall
  fall: 'fall', falls: 'fall', falling: 'fall', fell: 'fall', fallen: 'fall',
  // fly
  fly: 'fly', flies: 'fly', flying: 'fly', flew: 'fly', flown: 'fly',
  // ride
  ride: 'ride', rides: 'ride', riding: 'ride', rode: 'ride', ridden: 'ride',
  // sing
  sing: 'sing', sings: 'sing', singing: 'sing', sang: 'sing', sung: 'sing',
  // sit
  sit: 'sit', sits: 'sit', sitting: 'sit', sat: 'sit',
  // sleep
  sleep: 'sleep', sleeps: 'sleep', sleeping: 'sleep', slept: 'sleep',
  // speak
  speak: 'speak', speaks: 'speak', speaking: 'speak', spoke: 'speak', spoken: 'speak',
  // stand
  stand: 'stand', stands: 'stand', standing: 'stand', stood: 'stand',
  // tell
  tell: 'tell', tells: 'tell', telling: 'tell', told: 'tell',
  // throw
  throw: 'throw', throws: 'throw', throwing: 'throw', threw: 'throw', thrown: 'throw',
  // wear
  wear: 'wear', wears: 'wear', wearing: 'wear', wore: 'wear', worn: 'wear',
  // win
  win: 'win', wins: 'win', winning: 'win', won: 'win',
  // read (綴りは同じだが活用として明示)
  read: 'read', reads: 'read', reading: 'read',
  // can/could, will/would 等の助動詞(トークナイズでは残るが解析上は原形に寄せる)
  can: 'can', could: 'can', will: 'will', would: 'will',

  // 不規則名詞(複数形)
  children: 'child', feet: 'foot', teeth: 'tooth', mice: 'mouse',
  men: 'man', women: 'woman', people: 'person', geese: 'goose',

  // 人称代名詞(myをIとみなす等はしない。表層のまま個別語として扱うが、
  // よく使う代名詞の活用揺れだけ吸収する)
  me: 'i', my: 'i', mine: 'i',
};

// サイレントe動詞など、規則的な接尾辞除去だけでは正しいレンマに戻せない
// 活用形を明示的に列挙する(要件定義書6章: 軽量な方式の一部として)。
const SILENT_E_FORMS: Record<string, string> = {
  like: 'like', likes: 'like', liking: 'like', liked: 'like',
  love: 'love', loves: 'love', loving: 'love', loved: 'love',
  live: 'live', lives: 'live', living: 'live', lived: 'live',
  hope: 'hope', hopes: 'hope', hoping: 'hope', hoped: 'hope',
  hide: 'hide', hides: 'hide', hiding: 'hide', hid: 'hide',
  smile: 'smile', smiles: 'smile', smiling: 'smile', smiled: 'smile',
  dance: 'dance', dances: 'dance', dancing: 'dance', danced: 'dance',
  use: 'use', uses: 'use', using: 'use', used: 'use',
  close: 'close', closes: 'close', closing: 'close', closed: 'close',
  move: 'move', moves: 'move', moving: 'move', moved: 'move',
  bake: 'bake', bakes: 'bake', baking: 'bake', baked: 'bake',
  care: 'care', cares: 'care', caring: 'care', cared: 'care',
  share: 'share', shares: 'share', sharing: 'share', shared: 'share',
  save: 'save', saves: 'save', saving: 'save', saved: 'save',
  wave: 'wave', waves: 'wave', waving: 'wave', waved: 'wave',
  name: 'name', names: 'name', naming: 'name', named: 'name',
  invite: 'invite', invites: 'invite', inviting: 'invite', invited: 'invite',
  decide: 'decide', decides: 'decide', deciding: 'decide', decided: 'decide',
  arrive: 'arrive', arrives: 'arrive', arriving: 'arrive', arrived: 'arrive',
  drive: 'drive', drives: 'drive', driving: 'drive', drove: 'drive', driven: 'drive',
  bike: 'bike', bikes: 'bike', biking: 'bike', biked: 'bike',
  ride2: 'ride', // (rideは不規則動詞側で定義済み。ここはダミーではなく削除予定なので未使用)
};
delete SILENT_E_FORMS.ride2;

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

function isConsonant(ch: string): boolean {
  return /[a-z]/.test(ch) && !VOWELS.has(ch);
}

/**
 * 語尾の二重子音を1つに減らす(running -> runn -> run, stopped -> stopp -> stop)。
 * 二重子音でなければそのまま返す。
 */
function undoubleFinalConsonant(stem: string): string {
  if (stem.length >= 3) {
    const last = stem[stem.length - 1];
    const secondLast = stem[stem.length - 2];
    if (last === secondLast && isConsonant(last)) {
      return stem.slice(0, -1);
    }
  }
  return stem;
}

/**
 * 規則活用の接尾辞除去によるフォールバック。
 * 辞書(IRREGULAR_LEMMAS / SILENT_E_FORMS)に無い語に対して適用する。
 */
function ruleBasedLemma(word: string): string {
  // 3人称単数・複数形: -ies -> -y (studies -> study)
  if (word.endsWith('ies') && word.length > 4) {
    return word.slice(0, -3) + 'y';
  }
  // 過去形: -ied -> -y (studied -> study)
  if (word.endsWith('ied') && word.length > 4) {
    return word.slice(0, -3) + 'y';
  }
  // -es (ches/shes/xes/zes/sses の後): boxes -> box, watches -> watch
  if (
    word.length > 4 &&
    (word.endsWith('ches') || word.endsWith('shes') || word.endsWith('xes') ||
      word.endsWith('zes') || word.endsWith('sses'))
  ) {
    return word.slice(0, -2);
  }
  // -ing
  if (word.endsWith('ing') && word.length > 4) {
    const stem = word.slice(0, -3);
    return undoubleFinalConsonant(stem);
  }
  // -ed
  if (word.endsWith('ed') && word.length > 3) {
    const stem = word.slice(0, -2);
    return undoubleFinalConsonant(stem);
  }
  // 単純な複数形・3人称単数の -s (-ss で終わる語は除く。例: grass はそのまま)
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 2) {
    return word.slice(0, -1);
  }
  return word;
}

/**
 * 1トークン(小文字・記号除去済み)をレンマ化する。
 */
export function lemmatize(word: string): string {
  const w = word.toLowerCase();
  if (w in IRREGULAR_LEMMAS) return IRREGULAR_LEMMAS[w];
  if (w in SILENT_E_FORMS) return SILENT_E_FORMS[w];
  return ruleBasedLemma(w);
}

/**
 * 自由文字列をトークン化する(小文字化・アポストロフィ以外の記号除去・空白分割)。
 * Transcribeの`transcript`全文や、単語ごとのitem配列どちらにも使える。
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}
