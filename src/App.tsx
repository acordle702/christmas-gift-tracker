import { FormEvent, useEffect, useMemo, useState } from 'react';
import { jsPDF } from 'jspdf';
import { supabase } from './lib/supabase';

type Status = 'idea' | 'ordered' | 'delivered' | 'wrapped';
type Person = { id: string; name: string; relationship: string; sizes: string; budget: number };
type Gift = { id: string; person_id: string; name: string; store: string; price: number; status: Status; hiding_spot: string; link: string };
type ChatMessage = { role: 'user' | 'assistant'; content: string };
type ChatResult = { done?: boolean; reply?: string; conversation?: { messages: ChatMessage[] }; person?: string | null; relationship?: string; sizes?: string; budget?: number | null; gift?: string | null; store?: string; price?: number | null; status?: Status; hiding_spot?: string; link?: string | null };

const statusLabels: Record<Status, string> = { idea: 'Idea', ordered: 'Ordered', delivered: 'Delivered', wrapped: 'Wrapped' };
const statusOrder: Status[] = ['idea', 'ordered', 'delivered', 'wrapped'];
const amazonTag = import.meta.env.VITE_AMAZON_TAG as string | undefined;
const targetPartnerId = import.meta.env.VITE_TARGET_PARTNER_ID as string | undefined;
const targetTrackingDomain = (import.meta.env.VITE_TARGET_TRACKING_DOMAIN as string | undefined) || 'goto.target.com';

function shopUrl(name: string): string {
  const params = new URLSearchParams({ k: name });
  if (amazonTag) params.set('tag', amazonTag);
  return `https://www.amazon.com/s?k=${params.toString().replace('%3D', '=')}`;
}

function affiliateUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.hostname.includes('amazon.')) {
      if (amazonTag) { url.searchParams.set('tag', amazonTag); return url.toString(); }
    }
    if (url.hostname.includes('target.com')) {
      if (targetPartnerId) {
        const dest = encodeURIComponent(url.toString());
        return `https://${targetTrackingDomain}/c/${targetPartnerId}/u?u=${dest}`;
      }
    }
  } catch { /* not a valid URL, return as-is */ }
  return raw;
}

function App() {
  const [session, setSession] = useState<{ user: { email?: string | null } } | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session as { user: { email?: string | null } } | null);
      setAuthLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession as { user: { email?: string | null } } | null);
      setAuthLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function requestLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError('');
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: window.location.origin } });
    if (error) setAuthError('That email could not be sent just now. Please try again.');
    else setEmailSent(true);
  }

  if (authLoading) return <LoadingScreen />;
  if (!session) return <SignIn email={email} setEmail={setEmail} emailSent={emailSent} authError={authError} onSubmit={requestLink} />;
  return <Tracker email={session.user.email ?? ''} onSignOut={() => supabase.auth.signOut()} />;
}

function LoadingScreen() {
  return <div className="auth-page"><div className="auth-card"><BrandMark /><p className="muted">Opening your list...</p></div></div>;
}

function BrandMark() {
  return <div className="brand-mark">moms who claude<span className="cursor" aria-hidden="true" /></div>;
}

function renderChatContent(text: string) {
  const urlRegex = /(https?:\/\/[^\s]+)/gi;
  const parts = text.split(urlRegex);
  return parts.map((part, index) => {
    if (urlRegex.test(part)) {
      return <a key={index} href={affiliateUrl(part)} target="_blank" rel="noreferrer" className="chat-link">{part}</a>;
    }
    return <span key={index}>{part}</span>;
  });
}

function SignIn({ email, setEmail, emailSent, authError, onSubmit }: { email: string; setEmail: (value: string) => void; emailSent: boolean; authError: string; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <main className="auth-page">
    <div className="holiday-line" aria-hidden="true"><span /><span /><span /><span /></div>
    <section className="auth-card">
      <p className="eyebrow">A little less Christmas chaos</p>
      <BrandMark />
      <h1>Your Christmas list, finally in one place.</h1>
      {emailSent ? <div className="sent-state"><span className="sent-mark">✓</span><h2>Check your email.</h2><p>There’s a magic link waiting for you. Tap it to open your private tracker.</p><button className="text-button" onClick={() => window.location.reload()}>Use a different email</button></div> : <>
        <p className="intro">Type what you need to remember. Your people, gifts, budget, and hiding spots stay together.</p>
        <form className="auth-form" onSubmit={onSubmit}>
          <label htmlFor="email">Your email</label>
          <input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" required />
          <button className="primary-button" type="submit">Wrap up my link and have Santa deliver <span>→</span></button>
        </form>
        {authError && <p className="error-message">{authError}</p>}
        <p className="fine-print">Free to use. No ads. No selling your data. Only you can see your list.</p>
      </>}
    </section>
    <p className="auth-footer">Built for the mom doing Christmas in the margins.</p>
  </main>;
}

function Tracker({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showPersonForm, setShowPersonForm] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatError, setChatError] = useState('');
  const [personName, setPersonName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [sizes, setSizes] = useState('');
  const [budget, setBudget] = useState('');

  useEffect(() => { loadTracker(); }, []);

  async function loadTracker() {
    setLoading(true);
    const [peopleResult, giftsResult] = await Promise.all([
      supabase.from('gift_people').select('id, name, relationship, sizes, budget').order('created_at'),
      supabase.from('gift_items').select('id, person_id, name, store, price, status, hiding_spot, link').order('created_at'),
    ]);
    if (peopleResult.error || giftsResult.error) setNotice('Your list could not be loaded. Please refresh and try again.');
    setPeople((peopleResult.data ?? []) as Person[]);
    setGifts((giftsResult.data ?? []) as Gift[]);
    setLoading(false);
  }

  async function addPerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { data, error } = await supabase.from('gift_people').insert({ name: personName.trim(), relationship: relationship.trim(), sizes: sizes.trim(), budget: Number(budget) || 0 }).select('id, name, relationship, sizes, budget').maybeSingle();
    if (error || !data) { setNotice('That person could not be added.'); return; }
    setPeople((current) => [...current, data as Person]);
    setPersonName(''); setRelationship(''); setSizes(''); setBudget(''); setShowPersonForm(false);
  }

  async function updateGift(id: string, changes: Partial<Gift>) {
    const { error } = await supabase.from('gift_items').update(changes).eq('id', id);
    if (error) { setNotice('That update did not save.'); return; }
    setGifts((current) => current.map((gift) => gift.id === id ? { ...gift, ...changes } : gift));
  }

  async function addGift(personId: string, name: string, store: string, price: string, link: string) {
    const { data, error } = await supabase.from('gift_items').insert({ person_id: personId, name: name.trim(), store: store.trim() || 'Amazon', price: Number(price) || 0, status: 'idea', hiding_spot: '', link: link.trim() }).select('id, person_id, name, store, price, status, hiding_spot, link').maybeSingle();
    if (error || !data) { setNotice('That gift could not be added.'); return false; }
    setGifts((current) => [...current, data as Gift]);
    return true;
  }

  async function addChatNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!message.trim()) return;
    const userText = message.trim();
    setChatBusy(true); setChatError('');
    setChatHistory((current) => [...current, { role: 'user', content: userText }]);
    setMessage('');
    try {
      const { data, error } = await supabase.functions.invoke('chat-tracker', { body: { message: userText, conversation: { messages: chatHistory } } });
      if (error) throw error;
      const result = data as ChatResult;
      if (result.done && result.person && result.gift) {
        let person = people.find((item) => item.name.toLowerCase() === result.person?.toLowerCase());
        if (!person) {
          const created = await supabase.from('gift_people').insert({ name: result.person, relationship: result.relationship ?? '', sizes: result.sizes ?? '', budget: result.budget ?? 0 }).select('id, name, relationship, sizes, budget').maybeSingle();
          if (created.error || !created.data) throw new Error('Could not save person');
          person = created.data as Person;
          setPeople((current) => [...current, person as Person]);
        }
        const createdGift = await supabase.from('gift_items').insert({ person_id: person.id, name: result.gift, store: result.store || 'Amazon', price: result.price ?? 0, status: result.status || 'idea', hiding_spot: result.hiding_spot || '', link: result.link || '' }).select('id, person_id, name, store, price, status, hiding_spot, link').maybeSingle();
        if (createdGift.error || !createdGift.data) throw new Error('Could not save gift');
        setGifts((current) => [...current, createdGift.data as Gift]);
        setChatHistory([]);
      }
      setChatHistory((current) => [...current, { role: 'assistant', content: result.reply || (result.done ? 'Added to your list!' : 'Tell me more.') }]);
    } catch {
      setChatError('I couldn\u2019t sort that note yet. Try saying it another way.');
      setChatHistory((current) => current.slice(0, -1));
    }
    finally { setChatBusy(false); }
  }

  function resetChat() { setChatHistory([]); setChatError(''); }

  const totals = useMemo(() => {
    const planned = people.reduce((sum, person) => sum + Number(person.budget), 0);
    const spent = gifts.filter((gift) => gift.status !== 'idea').reduce((sum, gift) => sum + Number(gift.price), 0);
    return { planned, spent, left: planned - spent, wrapped: gifts.filter((gift) => gift.status === 'wrapped').length };
  }, [people, gifts]);

  const visiblePeople = people.filter((person) => {
    const query = search.toLowerCase().trim();
    if (!query) return true;
    return person.name.toLowerCase().includes(query) || gifts.some((gift) => gift.person_id === person.id && gift.hiding_spot.toLowerCase().includes(query));
  });

  if (loading) return <div className="app-page"><div className="loading-wrap"><BrandMark /><p>Gathering your list...</p></div></div>;
  return <main className="app-page">
    <header className="app-header"><a className="header-brand" href="#top"><BrandMark /><span className="season-label">Christmas tracker</span></a><div className="header-actions"><span className="welcome">Hi, {email.split('@')[0]}</span><button className="icon-button" onClick={() => setShowSettings(true)} aria-label="Open settings">Settings</button></div></header>
    <div className="holiday-banner"><div><span className="eyebrow">The calm before Christmas</span><h1>Let’s get this list out of your head.</h1><p>Tell me what you’re thinking. I’ll keep the details tidy.</p></div><span className="banner-spark">✦</span></div>
    <section className="summary-grid" aria-label="Budget summary"><Summary label="Budget" value={totals.planned} /><Summary label="Spent" value={totals.spent} /><Summary label="Left" value={totals.left} tone={totals.left < 0 ? 'warning' : undefined} /><div className="summary-card wrapped-card"><span className="summary-label">Wrapped</span><strong>{totals.wrapped}<small> gifts</small></strong><span className="wrapped-line"><span style={{ width: `${gifts.length ? Math.min(100, (totals.wrapped / gifts.length) * 100) : 0}%` }} /></span></div></section>
    <div className="toolbar"><div><p className="eyebrow">Your people</p><h2>The list so far</h2></div><div className="toolbar-actions"><label className="search-box"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a person or hiding spot" /></label><button className="secondary-button" onClick={() => setShowPersonForm((value) => !value)}>+ Add a person</button></div></div>
    {showPersonForm && <form className="person-form" onSubmit={addPerson}><div><label htmlFor="person-name">Name</label><input id="person-name" value={personName} onChange={(event) => setPersonName(event.target.value)} placeholder="Mom, Dad, Sophie..." required /></div><div><label htmlFor="relationship">Relationship</label><input id="relationship" value={relationship} onChange={(event) => setRelationship(event.target.value)} placeholder="Mom" /></div><div><label htmlFor="sizes">Sizes</label><input id="sizes" value={sizes} onChange={(event) => setSizes(event.target.value)} placeholder="M, 8 shoes" /></div><div><label htmlFor="budget">Budget</label><input id="budget" type="number" min="0" step="0.01" value={budget} onChange={(event) => setBudget(event.target.value)} placeholder="100" /></div><button className="primary-button" type="submit">Save person</button></form>}
    <section className="chat-panel"><div className="chat-heading"><div className="chat-orb">|</div><div><p className="eyebrow">Your holiday helper</p><h2>Tell me about a gift.</h2><p>I'll ask a few questions to get the details right.</p></div>{chatHistory.length > 0 && <button className="text-button chat-reset" type="button" onClick={resetChat}>Start over</button>}</div>{chatHistory.length > 0 && <div className="chat-thread">{chatHistory.map((msg, index) => <div key={index} className={`chat-bubble chat-bubble-${msg.role}`}>{renderChatContent(msg.content)}</div>)}</div>}<form className="chat-form" onSubmit={addChatNote}><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder={chatHistory.length ? "Reply..." : "e.g. I'm thinking of getting Dad a sweater"} rows={3} /><button className="primary-button" disabled={chatBusy}>{chatBusy ? 'Thinking...' : 'Send →'}</button></form>{chatError && <p className="notice" role="status">{chatError}</p>}<p className="chat-footnote">Your conversation helps fill in your list and isn't kept after the gift is saved.</p></section>
    <section className="people-grid">{visiblePeople.length ? visiblePeople.map((person) => <PersonCard key={person.id} person={person} gifts={gifts.filter((gift) => gift.person_id === person.id)} onUpdateGift={updateGift} onAddGift={addGift} />) : <EmptyState onAdd={() => setShowPersonForm(true)} />}</section>
    <footer className="app-footer"><span>moms who claude<span className="cursor" /></span><button className="text-button" onClick={onSignOut}>Sign out</button></footer>
    {showSettings && <Settings email={email} people={people} gifts={gifts} onClose={() => setShowSettings(false)} onSignOut={onSignOut} />}
  </main>;
}

function Summary({ label, value, tone }: { label: string; value: number; tone?: 'warning' }) { return <div className={`summary-card ${tone ?? ''}`}><span className="summary-label">{label}</span><strong>${Math.round(value).toLocaleString()}</strong></div>; }
function EmptyState({ onAdd }: { onAdd: () => void }) { return <div className="empty-state"><div className="empty-gift">+</div><h2>Start with one person.</h2><p>Who are you shopping for first?</p><button className="secondary-button" onClick={onAdd}>Add someone</button></div>; }

function PersonCard({ person, gifts, onUpdateGift, onAddGift }: { person: Person; gifts: Gift[]; onUpdateGift: (id: string, changes: Partial<Gift>) => Promise<void>; onAddGift: (personId: string, name: string, store: string, price: string, link: string) => Promise<boolean> }) {
  const [adding, setAdding] = useState(false);
  const [giftName, setGiftName] = useState('');
  const [giftStore, setGiftStore] = useState('');
  const [giftPrice, setGiftPrice] = useState('');
  const [giftLink, setGiftLink] = useState('');
  const [giftBusy, setGiftBusy] = useState(false);

  async function submitGift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!giftName.trim()) return;
    setGiftBusy(true);
    const ok = await onAddGift(person.id, giftName, giftStore, giftPrice, giftLink);
    setGiftBusy(false);
    if (ok) { setGiftName(''); setGiftStore(''); setGiftPrice(''); setGiftLink(''); setAdding(false); }
  }

  return <article className="person-card"><div className="person-heading"><div><span className="person-initial">{person.name.slice(0, 1).toUpperCase()}</span><div><h3>{person.name}</h3><p>{person.relationship || 'Someone special'}{person.sizes ? ` · ${person.sizes}` : ''}</p></div></div><span className="person-budget">${Math.round(person.budget)} planned</span></div><div className="gift-list">{gifts.length ? gifts.map((gift) => <GiftRow key={gift.id} gift={gift} onUpdate={onUpdateGift} />) : <p className="empty-gifts">No gifts yet.</p>}</div>{adding ? <form className="add-gift-form" onSubmit={submitGift}><input value={giftName} onChange={(event) => setGiftName(event.target.value)} placeholder="Gift name" required autoFocus /><div className="add-gift-row"><input value={giftStore} onChange={(event) => setGiftStore(event.target.value)} placeholder="Store" /><input value={giftPrice} type="number" min="0" step="0.01" onChange={(event) => setGiftPrice(event.target.value)} placeholder="$ Price" /></div><input value={giftLink} onChange={(event) => setGiftLink(event.target.value)} placeholder="Link (optional)" /><div className="add-gift-actions"><button className="primary-button" type="submit" disabled={giftBusy}>{giftBusy ? 'Saving...' : 'Save gift'}</button><button className="text-button" type="button" onClick={() => setAdding(false)}>Cancel</button></div></form> : <button className="add-gift-button" onClick={() => setAdding(true)}>+ Add a gift</button>}</article>;
}

function GiftRow({ gift, onUpdate }: { gift: Gift; onUpdate: (id: string, changes: Partial<Gift>) => Promise<void> }) {
  const [spot, setSpot] = useState(gift.hiding_spot);
  const [editingSpot, setEditingSpot] = useState(false);
  const [link, setLink] = useState(gift.link);
  const [editingLink, setEditingLink] = useState(false);
  const nextStatus = statusOrder[(statusOrder.indexOf(gift.status) + 1) % statusOrder.length];
  return <div className="gift-row"><div className="gift-main"><div className={`gift-check ${gift.status === 'wrapped' ? 'done' : ''}`}>{gift.status === 'wrapped' ? '✓' : ''}</div><div><strong>{gift.name}</strong><span>{gift.store} · ${Number(gift.price).toFixed(0)}</span></div></div><div className="gift-actions">{gift.link ? <a className="shop-link" href={affiliateUrl(gift.link)} target="_blank" rel="noreferrer">Link <span>↗</span></a> : <a className="shop-link" href={shopUrl(gift.name)} target="_blank" rel="noreferrer">Shop <span>↗</span></a>}<button className={`status-button status-${gift.status}`} onClick={() => onUpdate(gift.id, { status: nextStatus })}>{statusLabels[gift.status]}</button></div><div className="hiding-row"><span>Hidden:</span>{editingSpot ? <input autoFocus value={spot} onChange={(event) => setSpot(event.target.value)} onBlur={() => { setEditingSpot(false); void onUpdate(gift.id, { hiding_spot: spot }); }} onKeyDown={(event) => { if (event.key === 'Enter') { setEditingSpot(false); void onUpdate(gift.id, { hiding_spot: spot }); } }} placeholder="Where did you put it?" /> : <button className="spot-button" onClick={() => setEditingSpot(true)}>{gift.hiding_spot || 'Add a hiding spot'}</button>}</div><div className="link-row"><span>Link:</span>{editingLink ? <input autoFocus value={link} onChange={(event) => setLink(event.target.value)} onBlur={() => { setEditingLink(false); void onUpdate(gift.id, { link: link.trim() }); }} onKeyDown={(event) => { if (event.key === 'Enter') { setEditingLink(false); void onUpdate(gift.id, { link: link.trim() }); } }} placeholder="Paste a product link" /> : <button className="spot-button" onClick={() => setEditingLink(true)}>{gift.link ? 'Edit link' : 'Add a link'}</button>}</div><small className="disclosure">We may earn a commission from qualifying purchases.</small></div>;
}

function Settings({ email, people, gifts, onClose, onSignOut }: { email: string; people: Person[]; gifts: Gift[]; onClose: () => void; onSignOut: () => void }) {
  function exportPdf() {
    const pdf = new jsPDF();
    pdf.setTextColor('#2A1B22'); pdf.setFontSize(22); pdf.text('moms who claude', 20, 24); pdf.setFontSize(11); pdf.text('Christmas gift list', 20, 32); pdf.text(email, 20, 40);
    let y = 56;
    people.forEach((person) => { pdf.setFontSize(15); pdf.text(`${person.name}  ·  $${person.budget} planned`, 20, y); y += 8; gifts.filter((gift) => gift.person_id === person.id).forEach((gift) => { pdf.setFontSize(11); pdf.text(`- ${gift.name} · $${gift.price} · ${statusLabels[gift.status]}`, 28, y); y += 6; }); y += 5; });
    pdf.save('moms-who-claude-christmas-list.pdf');
  }
  async function deleteList() {
    if (!window.confirm('Delete your account, saved people, gifts, and list data? This cannot be undone.')) return;
    const { error } = await supabase.functions.invoke('delete-account', { body: {} });
    if (error) {
      window.alert('Your account could not be deleted right now. Please try again.');
      return;
    }
    await supabase.auth.signOut();
  }
  return <div className="modal-backdrop" role="presentation" onClick={onClose}><aside className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(event) => event.stopPropagation()}><div className="panel-heading"><div><p className="eyebrow">Your account</p><h2 id="settings-title">Settings</h2></div><button className="close-button" onClick={onClose} aria-label="Close settings">×</button></div><p className="settings-email">{email}</p><button className="settings-action" onClick={exportPdf}><span>↓</span><div><strong>Export your list</strong><small>Save a printable PDF for wrapping day.</small></div></button><div className="privacy-copy"><h3>A small privacy promise</h3><p>Your list is private to you. We don’t sell your information or use your gift notes for advertising.</p></div><button className="danger-button" onClick={deleteList}>Delete my account and data</button><button className="text-button panel-signout" onClick={onSignOut}>Sign out</button></aside></div>;
}

export default App;
