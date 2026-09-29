'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDownLeft, ArrowRight, CalendarDays, Car, Check, ChevronRight, Inbox, LayoutDashboard, LogOut, Menu, MessageSquare, Plus, Search, Settings2, Sparkles, UserPlus, Users, Wrench, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { appointmentStatusLabels, appointmentStatuses, isWorkshopEmpty, localDateParts, statusLabels, statuses, type Appointment, type Command, type Customer, type RequestStatus, type ServiceRequest, type State, type Vehicle } from '@/lib/domain';
import { DemoRepository, type WorkshopRepository } from '@/lib/repository';
import { getSupabase, isSupabaseMode } from '@/lib/supabase/client';
import { SupabaseRepository } from '@/lib/supabase/repository';
import { acceptInvitation, declineInvitation, myPendingInvitation, type PendingInvitation } from '@/lib/supabase/team';
import { resolveSession } from '@/lib/supabase/session';
import { AuthScreen } from './auth-screen';
import { AppointmentCard, Badge, dateLabel, Empty, Field, initials, Modal } from './ui';
import { AppointmentEditor, CustomerEditor, Settings, VehicleEditor } from './editors';
import { Resources } from './resources';
import { Hours } from './hours';
import { Team } from './team';
import { GettingStarted } from './getting-started';
import { defaultQuery, PAGE_SIZE } from '@/lib/queries';
import type { FindOptions } from './lookup';
import { Reception } from './reception';
import { Calendar } from './calendar';
import { calendarQueryFor } from '@/lib/calendar-layout';
import { newRequestsMessage } from '@/lib/in-app-alerts';
import { ReadCoordinator } from '@/lib/read-coordinator';
import { withTimeout } from '@/lib/with-timeout';

// How often the app checks, in the background, whether a new solicitud has
// arrived (public reception, or another team member) while this tab stays
// open without the user navigating -- the only thing that otherwise makes
// state.metrics.new_requests advance. Paused while the tab isn't visible.
const NEW_REQUESTS_POLL_MS = 30000;
// A hung network request would otherwise leave `pollInFlight` (see the poll
// effect) stuck at true forever, silently disabling every future tick since
// nothing would ever reset it. Bounding the poll's own wait time (withTimeout)
// guarantees its `finally` always runs within this long, so the poll
// self-heals instead of being permanently disabled by one bad request.
const POLL_TIMEOUT_MS = 15000;

const pages = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, description: 'Todo lo importante, de un vistazo.' },
  { id: 'requests', label: 'Solicitudes', icon: Inbox, description: 'Cada consulta es una oportunidad de ayudar.' },
  { id: 'customers', label: 'Clientes', icon: Users, description: 'Las personas que confían en tu taller.' },
  { id: 'vehicles', label: 'Vehículos', icon: Car, description: 'Cada vehículo, conectado con su cliente.' },
  { id: 'conversations', label: 'Conversaciones', icon: MessageSquare, description: 'El contexto completo de cada consulta.' },
  { id: 'appointments', label: 'Citas', icon: CalendarDays, description: 'Organiza el trabajo que está por venir.' },
  { id: 'reception', label: 'Registrar solicitud manual', icon: Sparkles, description: 'Registra una consulta que te llegó por teléfono o en persona.' },
  { id: 'team', label: 'Equipo', icon: UserPlus, description: 'Invita y gestiona quién tiene acceso a tu taller.' },
  { id: 'settings', label: 'Configuración', icon: Settings2, description: 'Haz que TALLERIA se adapte a tu taller.' },
] as const;
type Page = typeof pages[number]['id'];
type Editor = { type: 'customer'; initial?: Customer } | { type: 'vehicle'; initial?: Vehicle } | { type: 'appointment'; initial?: Appointment; request?: ServiceRequest; initialResourceId?: string; initialStartsAt?: string } | null;
export function Workspace() {
  const repository = useRef<WorkshopRepository | null>(null);
  const [offset, setOffset] = useState(0);
  const [dataLoading, setDataLoading] = useState(false);
  const [cancelId, setCancelId] = useState<{ id: string; version?: number; request_version?: number } | null>(null);
  const queryKey = useRef('');
  const loadSequence = useRef(0);
  // Which calendar range is actually loaded into `state` right now (null
  // until the first successful calendar load). Compared at render time
  // against the range the current anchor/mode/timezone want, so navigating
  // to a new date never shows the previous date's citas while the new range
  // is still loading -- or forever, if that load then fails. State, not a
  // ref: it's read during render, so it must be able to trigger one.
  const [loadedCalendarKey, setLoadedCalendarKey] = useState<string | null>(null);
  // The last new_requests count this session actually saw, to tell "a
  // solicitud arrived since we last checked" from "this is just what the
  // workshop already had" (the very first load) or "the count went down
  // because staff processed one". Set from every successful snapshot this
  // session sees, whichever page/poll it came from -- see
  // checkForNewRequests -- so the comparison stays correct across
  // navigation too, not just across polls.
  const knownNewRequestsRef = useRef<number | null>(null);
  const find: FindOptions = useCallback((kind, text) => repository.current?.lookup(kind, text) ?? Promise.resolve([]), []);
  const mutation = useRef(false);
  const recovering = useRef(false);
  const [state, setState] = useState<State | null>(null);
  const [screen, setScreen] = useState<'loading' | 'auth' | 'onboarding' | 'invitation' | 'reset-password' | 'app'>(isSupabaseMode ? 'loading' : 'auth');
  const [pendingInvitation, setPendingInvitation] = useState<PendingInvitation | null>(null);
  const [passwordUpdated, setPasswordUpdated] = useState(false);
  const [page, setPage] = useState<Page>('dashboard');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<RequestStatus | Appointment['status'] | 'all'>('all');
  const [agendaView, setAgendaView] = useState<'calendar' | 'list'>('calendar');
  const [calendarMode, setCalendarMode] = useState<'day' | 'week'>('week');
  const [calendarAnchor, setCalendarAnchor] = useState<string | null>(null);
  // Client-side only: the calendar already loads every appointment in the
  // visible range (see the 'calendar' view query below), so narrowing what's
  // shown by resource/status needs no new query param -- unlike the paginated
  // list's search/status, which do go through `filter`/`search` above.
  const [calendarResourceFilter, setCalendarResourceFilter] = useState<'all' | string>('all');
  const [calendarStatusFilter, setCalendarStatusFilter] = useState<Appointment['status'] | 'all'>('all');
  const [mobile, setMobile] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!mobile) return;
    sidebarRef.current?.querySelector<HTMLElement>('a, button:not(:disabled)')?.focus();
    const menuButton = menuButtonRef.current;
    return () => { menuButton?.focus(); };
  }, [mobile]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [conversation, setConversation] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor>(null);
  const [resetOpen, setResetOpen] = useState(false);
  // A mutation's own post-write reload is the one read guaranteed to
  // reflect at least the write it just made, so execute() always applies it
  // unconditionally -- but that unconditional priority is exactly what makes
  // every OTHER read here ("ordinary reads": the background poll, load(),
  // refresh(), page navigation, and the demo cross-tab sync) unsafe to apply
  // if a mutation touched their window at all, and ordering by which one
  // *started* first isn't enough between two ordinary reads either, since
  // whichever one resolves last can otherwise regress a value another
  // already correctly applied. See src/lib/read-coordinator.ts for the two
  // counters this uses and why a plain before/after boolean check on
  // `mutation.current` (an earlier version of this fix) isn't sufficient: a
  // mutation can start and finish entirely inside an ordinary read's round
  // trip, leaving the flag back at false by the time that read checks it.
  //
  // This does not, and without a server-side monotonic marker cannot,
  // protect a save's own reload against being stale relative to a
  // *different*, genuinely concurrent external change (e.g. a new público
  // solicitud landing in the same instant as an unrelated save elsewhere in
  // the app) -- no purely client-side ordering can tell that case apart from
  // the ordinary one. The next ordinary read to run once the save has fully
  // finished (mutation.current false again) will correctly observe and
  // announce it instead, delayed rather than lost -- the accepted trade-off
  // here rather than adding new Supabase-side infrastructure for this block.
  const [reads] = useState(() => new ReadCoordinator());
  const pollInFlight = useRef(false);
  // `notify=false` is a silent resync (used after the user's own mutation or
  // an explicit refresh): the ref must still track the real count, or the
  // next passive check compares against a stale number and can misfire in
  // either direction -- but those actions already have their own
  // confirmation, so they must never also trigger "ha llegado una solicitud
  // nueva".
  function checkForNewRequests(metrics: State['metrics'], notify: boolean) {
    if (notify) {
      const message = newRequestsMessage(knownNewRequestsRef.current, metrics?.new_requests);
      if (message) setNotice(message);
    }
    if (metrics?.new_requests !== undefined) knownNewRequestsRef.current = metrics.new_requests;
  }
  const load = useCallback(async (repo: WorkshopRepository) => {
    repository.current = repo;
    // load() is a plain read like any other ordinary one (poll, refresh,
    // navigation, demo sync), not a write -- it has no special claim to
    // being fresher than a concurrent one of those. It usually is the very
    // first read of a brand-new session, when nothing else could possibly
    // be racing it, but it CAN be re-triggered while already in 'app' (a
    // Supabase auth token refresh), so it claims and checks like everyone
    // else instead of assuming it always wins.
    const claim = reads.claimRead();
    try {
      setPage('dashboard'); setOffset(0); setSearch(''); setFilter('all'); queryKey.current = JSON.stringify(defaultQuery);
      const next = await repo.load(defaultQuery);
      // A password-recovery event may have taken over the screen while this
      // was in flight; never let a stale load overwrite it.
      if (recovering.current) return;
      const fresh = reads.isFresh(claim);
      // Baseline for this (possibly new) workshop/session -- silent, no
      // notice: whatever new_requests already was before this tab opened is
      // not "new" by definition. Only set when still fresh; otherwise a
      // faster concurrent read already established the real baseline.
      if (fresh) knownNewRequestsRef.current = next.metrics?.new_requests ?? null;
      setState(prev => (fresh || !prev ? next : { ...next, metrics: prev.metrics }));
      setScreen('app'); setError('');
    } catch (err) {
      if (recovering.current) return;
      setError(err instanceof Error ? err.message : 'No se han podido cargar los datos.'); setScreen('auth');
    }
  }, [reads]);
  useEffect(() => {
    if (!isSupabaseMode) return;
    const raw = (window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '') || window.location.search.slice(1);
    if (!raw.includes('error')) return;
    const params = new URLSearchParams(raw);
    if (!params.get('error')) return;
    const code = params.get('error_code');
    const text = code === 'otp_expired'
      ? 'El enlace de confirmación ha caducado o ya se ha usado. Vuelve a registrarte o inicia sesión para solicitar uno nuevo.'
      : params.get('error_description') || 'No se ha podido completar la verificación del correo.';
    window.history.replaceState(null, '', window.location.pathname);
    // Deferred to avoid a setState call synchronous with the effect body.
    setTimeout(() => setError(text), 0);
  }, []);
  useEffect(() => {
    if (!isSupabaseMode) return;
    let alive = true;
    async function session() {
      // getSupabase() is called lazily inside each dep, not hoisted out here:
      // it throws synchronously when the app is misconfigured (missing/invalid
      // URL or key), and only calls made through resolveSession's own
      // try/catch are guaranteed to turn that into a visible error instead of
      // an unhandled rejection that leaves the screen stuck on 'loading'.
      const resolution = await resolveSession({
        async getUser() { const { data: { user }, error } = await getSupabase().auth.getUser(); return { user, error }; },
        async getMembership(userId) { const { data, error } = await getSupabase().from('workshop_members').select('workshop_id').eq('user_id', userId).limit(1).maybeSingle(); return { data, error }; },
        getPendingInvitation: myPendingInvitation,
      });
      // A PASSWORD_RECOVERY event may land while any of the awaits above were
      // in flight (the Supabase SDK can resolve getUser()/session lookups
      // before it dispatches that event to onAuthStateChange). Once
      // recovering.current is set, the reset-password screen must keep
      // absolute priority: never let this already-in-flight call overwrite
      // it with the dashboard, invitation or onboarding screen.
      if (!alive || recovering.current) return;
      if (resolution.screen === 'app') { await load(new SupabaseRepository(resolution.workshopId)); return; }
      if (resolution.screen === 'invitation') { setPendingInvitation(resolution.pending); setScreen('invitation'); return; }
      if (resolution.screen === 'onboarding') { setScreen('onboarding'); return; }
      setState(null);
      if (resolution.error) setError(resolution.error);
      setScreen('auth');
    }
    void session();
    let cleanup = () => {};
    try {
      // Defer work to avoid awaiting Supabase API inside its auth lock.
      const { data } = getSupabase().auth.onAuthStateChange(event => { setTimeout(() => {
        if (!alive) return;
        // A recovery link signs the user in only to let them set a new
        // password; route to that screen instead of resolving a normal
        // session, and ignore the SIGNED_OUT/USER_UPDATED churn that flow
        // produces so it doesn't yank the screen away mid-flow.
        if (event === 'PASSWORD_RECOVERY') { recovering.current = true; setScreen('reset-password'); return; }
        if (recovering.current) return;
        void session();
      }, 0); });
      cleanup = () => data.subscription.unsubscribe();
    } catch { /* The loading error explains the missing configuration. */ }
    return () => { alive = false; cleanup(); };
  }, [load]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (isSupabaseMode) return;
    const sync = () => {
      if (!repository.current || screen !== 'app') return;
      const claim = reads.claimRead();
      void repository.current.load().then(next => {
        const fresh = reads.isFresh(claim);
        setState(prev => (fresh ? next : (prev ? { ...next, metrics: prev.metrics } : next)));
        if (fresh) checkForNewRequests(next.metrics, true);
      }).catch(() => setError('No se han podido actualizar los datos demo.'));
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [load, screen, reads]);
  useEffect(() => {
    // Background awareness of new solicitudes for a tab that just stays open
    // on one page: everything else that refreshes state.metrics.new_requests
    // (navigation, a manual refresh, a mutation's own reload, the demo
    // cross-tab listener above) only happens when the user does something.
    // This is the only thing that checks on its own, on a timer, paused
    // while the tab isn't visible so a backgrounded tab doesn't poll for
    // nothing.
    //
    // Deliberately uses peekMetrics(), never load(): this runs on a fixed
    // interval regardless of which page/query the user currently has open,
    // and load() remembers whatever query it's given as "the" query that
    // execute()'s post-mutation reload reuses afterward -- a poll must never
    // overwrite that with an unrelated view.
    if (screen !== 'app') return;
    let cancelled = false;
    async function poll() {
      // Captured up front: `screen` alone doesn't change across a demo role
      // switch or "Restablecer demo" (both stay on 'app' and just swap
      // repository.current), so an in-flight poll checked only `cancelled`
      // could still apply a just-abandoned workshop's metrics to the new
      // one. Comparing identity after the await catches that, the same way
      // the page-data effect guards against an out-of-order response with
      // `sequence === loadSequence.current`.
      //
      // `pollInFlight` is just an efficiency guard (skip a redundant
      // request); the actual correctness against overlapping polls, a
      // concurrent mutation, or a concurrent load()/refresh()/navigation
      // comes from `reads.isFresh()` below -- see read-coordinator.ts.
      const repo = repository.current;
      if (!repo || document.visibilityState !== 'visible' || reads.mutationInProgress || pollInFlight.current) return;
      pollInFlight.current = true;
      const claim = reads.claimRead();
      try {
        const metrics = await withTimeout(repo.peekMetrics(), POLL_TIMEOUT_MS);
        if (cancelled || repository.current !== repo || !reads.isFresh(claim)) return;
        checkForNewRequests(metrics, true);
        setState(prev => (prev && metrics ? { ...prev, metrics } : prev));
      } catch { /* a silent background check failing isn't worth an error banner; the next tick tries again */ }
      finally { pollInFlight.current = false; }
    }
    const interval = setInterval(() => void poll(), NEW_REQUESTS_POLL_MS);
    function onVisibilityChange() { if (document.visibilityState === 'visible') void poll(); }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => { cancelled = true; clearInterval(interval); document.removeEventListener('visibilitychange', onVisibilityChange); };
  }, [screen, reads]);
  const timezone = state?.workshop.timezone;
  useEffect(() => {
    // 'team' is a local page backed by its own RPCs (see team.tsx), not by
    // workspace_snapshot's paginated view set, so it never fetches here.
    if (screen !== 'app' || !repository.current || page === 'team') return;
    const isCalendar = page === 'appointments' && agendaView === 'calendar' && !!timezone;
    const query = isCalendar
      ? calendarQueryFor(calendarAnchor ?? localDateParts(new Date(), timezone!).date, calendarMode, timezone!)
      : { view: page, offset, search, status: filter };
    const key = JSON.stringify(query);
    if (queryKey.current === key) return;
    const sequence = ++loadSequence.current;
    const metricsClaim = reads.claimRead();
    let active = true;
    const timer = setTimeout(() => {
      setDataLoading(true);
      void repository.current!.load(query).then(next => {
        if (active && sequence === loadSequence.current) {
          const fresh = reads.isFresh(metricsClaim);
          setState(prev => (fresh ? next : { ...next, metrics: prev?.metrics ?? next.metrics }));
          queryKey.current = key;
          if (isCalendar) setLoadedCalendarKey(key);
          if (fresh) checkForNewRequests(next.metrics, true);
        }
      }).catch(err => setError(err instanceof Error ? err.message : 'No se pueden cargar los datos.'))
        .finally(() => { if (active && sequence === loadSequence.current) setDataLoading(false); });
    }, search ? 200 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [screen, page, offset, search, filter, agendaView, calendarMode, calendarAnchor, timezone, reads]);
  async function execute(command: Command) {
    if (!repository.current || mutation.current) return false;
    mutation.current = true; reads.beginMutation(); setBusy(true); setError('');
    // reads.beginMutation()/endMutation() bracket this whole call, the same
    // way mutation.current already does; the poll (and every other ordinary
    // read) defers to it via reads.isFresh() -- see read-coordinator.ts for
    // why a plain before/after check on mutation.current isn't enough on its
    // own. The result below always applies unconditionally on success -- a
    // save's own reload is the one read that must never defer to anything
    // else, since it's guaranteed to reflect the write it just made -- but
    // knownNewRequestsRef still needs a silent resync (notify=false): the
    // count this mutation itself just changed (e.g. creating a solicitud
    // from Recepción) must not be mistaken for a passively-discovered
    // arrival on the next check.
    try {
      const result = await repository.current.execute(command);
      setState(result);
      checkForNewRequests(result.metrics, false);
      setNotice('Cambios guardados');
      return true;
    }
    catch (err) { setError(err instanceof Error ? err.message : 'No se han podido guardar los cambios.'); return false; }
    finally { mutation.current = false; reads.endMutation(); setBusy(false); }
  }
  async function refresh() {
    if (!repository.current || busy) return;
    const claim = reads.claimRead();
    try {
      const next = await repository.current.load();
      const fresh = reads.isFresh(claim);
      setState(prev => (fresh ? next : (prev ? { ...next, metrics: prev.metrics } : next)));
      if (fresh) checkForNewRequests(next.metrics, false);
      setEditor(null); setSelected(null); setConversation(null); setCancelId(null); setError(''); setNotice('Datos actualizados. Puedes volver a abrir el registro.');
    }
    catch { setError('No se han podido actualizar los datos. Vuelve a intentarlo.'); }
  }
  async function onboarding(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const name = String(new FormData(e.currentTarget).get('name')).trim();
      const { data, error: rpcError } = await getSupabase().rpc('create_workshop', { p_name: name });
      if (rpcError) throw rpcError;
      await load(new SupabaseRepository(data as string));
    } catch (err) { setError(err instanceof Error ? err.message : 'No se ha podido crear el taller.'); }
    finally { setBusy(false); }
  }
  async function acceptInvite() {
    if (!pendingInvitation) return;
    setBusy(true); setError('');
    try { const workshopId = await acceptInvitation(pendingInvitation.id); setPendingInvitation(null); await load(new SupabaseRepository(workshopId)); }
    catch (err) { setError(err instanceof Error ? err.message : 'No se ha podido aceptar la invitación.'); }
    finally { setBusy(false); }
  }
  async function declineInvite() {
    if (!pendingInvitation) return;
    setBusy(true); setError('');
    try { await declineInvitation(pendingInvitation.id); setPendingInvitation(null); setScreen('onboarding'); }
    catch (err) { setError(err instanceof Error ? err.message : 'No se ha podido rechazar la invitación.'); }
    finally { setBusy(false); }
  }
  async function updatePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const form = new FormData(e.currentTarget);
      const password = String(form.get('password')), confirm = String(form.get('confirm'));
      if (password !== confirm) throw new Error('Las contraseñas no coinciden.');
      const { error: updateError } = await getSupabase().auth.updateUser({ password });
      if (updateError) throw updateError;
      await getSupabase().auth.signOut();
      setPasswordUpdated(true);
    } catch (err) { setError(err instanceof Error ? err.message : 'No se ha podido actualizar la contraseña.'); }
    finally { setBusy(false); }
  }
  function backToLogin() { recovering.current = false; setPasswordUpdated(false); setError(''); setScreen('auth'); }
  async function logout() {
    try { if (isSupabaseMode) { const { error } = await getSupabase().auth.signOut(); if (error) throw error; } repository.current = null; setState(null); setPage('dashboard'); setSelected(null); setConversation(null); setEditor(null); setScreen('auth'); }
    catch (err) { setError(err instanceof Error ? err.message : 'No se ha podido cerrar la sesión.'); }
  }
  function navigate(next: Page) { setOffset(0); setFilter('all'); setPage(next); setSearch(''); setSelected(null); setConversation(null); setMobile(false); setError(''); setCalendarResourceFilter('all'); setCalendarStatusFilter('all'); }
  async function resetDemo() {
    try {
      await load(new DemoRepository());
      const next = await new DemoRepository().reset();
      // repository.current keeps the same instance load() just set (reset()
      // only rewrites the localStorage it reads from), so a poll already in
      // flight against it would pass the identity check untouched --
      // invalidate pending reads again, so it can't apply pre-reset data
      // afterward.
      reads.invalidatePendingReads();
      knownNewRequestsRef.current = next.metrics?.new_requests ?? null;
      setState(next); setScreen('app'); setResetOpen(false); setNotice('Demo restablecida');
    } catch { setError('No se puede guardar la demo. Comprueba que el navegador permita el almacenamiento local.'); }
  }
  const errorBanner = error && <div className="error-toast" role="alert"><span>{error}</span>{screen === 'app' && <button className="text-button" disabled={busy} onClick={() => void refresh()}>Actualizar datos</button>}<button className="icon-button" aria-label="Cerrar aviso" onClick={() => setError('')}><X size={17}/></button></div>;
  if (screen === 'loading') return <main className="loading"><Wrench size={32}/><p>Preparando tu taller…</p></main>;
  if (screen === 'auth') return <>{errorBanner}<AuthScreen onDemo={() => void load(new DemoRepository())}/>{!isSupabaseMode && error && <button className="recovery button" onClick={() => setResetOpen(true)}>Restablecer demo</button>}{resetOpen && <Modal title="Restablecer datos demo" onClose={() => setResetOpen(false)}><p>Se borrarán los cambios guardados de la demo en este navegador.</p><button className="button primary" onClick={() => void resetDemo()}>Restablecer datos</button></Modal>}</>;
  if (screen === 'onboarding') return <main className="onboarding">{errorBanner}<form className="card" onSubmit={onboarding}><span className="feature-icon"><Wrench/></span><h1>Vamos a preparar tu taller</h1><p className="muted">Tu cuenta ya está lista. Crea el espacio de trabajo de tu negocio.</p><Field label="Nombre del taller"><input required name="name" minLength={2} maxLength={100} placeholder="Taller Motor Norte"/></Field><button className="button primary full" disabled={busy}>Crear mi taller<ArrowRight size={18}/></button><button type="button" className="text-button" onClick={() => void logout()}>Cerrar sesión</button></form></main>;
  if (screen === 'invitation') return <main className="onboarding">{errorBanner}<div className="card"><span className="feature-icon"><Wrench/></span><h1>Te han invitado a un taller</h1>{pendingInvitation && <p className="muted">{pendingInvitation.invited_by_email} te ha invitado a unirte a <b>{pendingInvitation.workshop_name}</b> como parte de su equipo.</p>}<button className="button primary full" disabled={busy} onClick={() => void acceptInvite()}>Unirme al taller<ArrowRight size={18}/></button><button type="button" className="text-button" disabled={busy} onClick={() => void declineInvite()}>Rechazar y crear mi propio taller</button><button type="button" className="text-button" onClick={() => void logout()}>Cerrar sesión</button></div></main>;
  if (screen === 'reset-password') return <main className="onboarding">{errorBanner}{passwordUpdated
    ? <div className="card"><span className="feature-icon"><Wrench/></span><h1>Contraseña actualizada</h1><p className="muted">Ya puedes iniciar sesión con tu nueva contraseña.</p><button className="button primary full" onClick={backToLogin}>Ir a iniciar sesión<ArrowRight size={18}/></button></div>
    : <form className="card" onSubmit={updatePassword}><span className="feature-icon"><Wrench/></span><h1>Establece tu nueva contraseña</h1><Field label="Nueva contraseña"><input required name="password" type="password" minLength={8} maxLength={128} autoComplete="new-password"/></Field><Field label="Confirma tu contraseña"><input required name="confirm" type="password" minLength={8} maxLength={128} autoComplete="new-password"/></Field><button className="button primary full" disabled={busy}>{busy ? 'Guardando…' : 'Guardar contraseña'}<ArrowRight size={18}/></button></form>}</main>;
  if (!state) return null;
  const currentPage = pages.find(p => p.id === page)!;
  const newCount = state.metrics?.new_requests ?? 0;
  const owner = state.role !== 'staff';
  const onPage = (id: string) => state.page_info?.view === page && state.page_info.ids.includes(id);
  const customer = (id: string) => state.customers.find(c => c.id === id);
  const vehicle = (id: string) => state.vehicles.find(v => v.id === id);
  const filteredRequests = state.requests.filter(r => onPage(r.id));
  const upcoming = state.appointments.filter(a => a.status === 'scheduled').sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const pendingClients = state.metrics?.pending_customers ?? 0;
  const activeRequest = state.requests.find(r => r.id === selected);
  const activeConversation = state.conversations.find(c => c.id === conversation);
  const day = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: state.workshop.timezone }).format(new Date());
  const todayISO = localDateParts(new Date(), state.workshop.timezone).date;
  function requestTable(items: ServiceRequest[]) {
    return items.length ? <div className="table-wrap"><table><thead><tr><th>Cliente / vehículo</th><th>Motivo de la consulta</th><th>Estado</th><th>Recibida</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>{items.map(r => { const c = customer(r.customer_id), v = vehicle(r.vehicle_id); const publicSource = state!.conversations.find(conv => conv.id === r.conversation_id)?.channel === 'public'; return <tr key={r.id}><td><div className="person-cell"><span className="avatar">{initials(c?.name ?? '?')}</span><div><b>{c?.name}</b><small>{v?.brand} {v?.model} · {v?.plate || 'Sin matrícula'}</small></div></div></td><td><span className="reason-cell">{r.reason}</span><small className="source"><MessageSquare size={12}/> {publicSource ? 'Recepción digital' : 'Registro manual'}</small></td><td><Badge status={r.status}/></td><td className="muted nowrap">{dateLabel(r.created_at, state!.workshop.timezone)}</td><td><button className="icon-button" aria-label={'Ver solicitud de ' + c?.name} onClick={() => setSelected(r.id)}><ChevronRight size={18}/></button></td></tr>; })}</tbody></table></div> : <Empty title="No hay solicitudes aquí">Prueba otra búsqueda o registra una manualmente.</Empty>;
  }
  function appointmentCard(a: Appointment) {
    const r = state!.requests.find(r => r.id === a.request_id);
    return <AppointmentCard key={a.id} appointment={a} customerName={r && customer(r.customer_id)?.name} reason={r?.reason} resourceName={state!.resources?.find(res => res.id === a.resource_id)?.name} timezone={state!.workshop.timezone} actionable={page === 'appointments'} busy={busy}
      onReprogram={() => setEditor({ type: 'appointment', initial: a })}
      onComplete={() => void execute({ type: 'appointment_status', id: a.id, version: a.version, request_version: r?.version, status: 'completed' })}
      onCancel={() => setCancelId({ id: a.id, version: a.version, request_version: r?.version })}/>;
  }
  return <div className="app-shell">{mobile && <button className="sidebar-backdrop" aria-label="Cerrar menú" onClick={() => setMobile(false)}/>}<aside ref={sidebarRef} className={'sidebar ' + (mobile ? 'is-open' : '')} role={mobile ? 'dialog' : undefined} aria-modal={mobile ? true : undefined} aria-label={mobile ? 'Menú' : undefined} onKeyDown={e => {
    if (!mobile) return;
    if (e.key === 'Escape') { setMobile(false); return; }
    if (e.key === 'Tab') {
      const items = e.currentTarget.querySelectorAll<HTMLElement>('a, button:not(:disabled)');
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  }}><a href="#" className="brand" onClick={e => { e.preventDefault(); navigate('dashboard'); }}><span className="brand-mark"><Wrench size={21}/></span>TALLERIA<span className="brand-dot">.</span></a><div className="workshop-switch"><span className="workshop-avatar"><Wrench size={18}/></span><div><b>{state.workshop.name}</b><small>Espacio de trabajo</small></div></div><span className="nav-label">TU TALLER</span><nav aria-label="Navegación principal">{pages.filter(p => p.id !== 'settings' && p.id !== 'reception' && p.id !== 'team').map(p => <button key={p.id} className={'nav-item ' + (page === p.id ? 'active' : '')} onClick={() => navigate(p.id)} aria-current={page === p.id ? 'page' : undefined}><p.icon size={19}/>{p.label}{p.id === 'requests' && newCount > 0 && <span className="nav-count">{newCount}</span>}</button>)}</nav><span className="nav-label second-label">OTRAS HERRAMIENTAS</span><button className={'nav-item ' + (page === 'reception' ? 'active' : '')} onClick={() => navigate('reception')}><Sparkles size={19}/><span>Registro manual</span></button><div className="sidebar-bottom"><div className="reception-status"><span className="online"><i/>Tu recepción, organizada</span><p>Menos interrupciones.<br/>Más tiempo para tu taller.</p></div>{owner && isSupabaseMode && <button className={'nav-item ' + (page === 'team' ? 'active' : '')} onClick={() => navigate('team')}><UserPlus size={19}/>Equipo</button>}{owner && <button className={'nav-item ' + (page === 'settings' ? 'active' : '')} onClick={() => navigate('settings')}><Settings2 size={19}/>Configuración</button>}<button className="nav-item" onClick={() => void logout()}><LogOut size={18}/>{isSupabaseMode ? 'Cerrar sesión' : 'Salir de la demo'}</button></div></aside><div className="main-shell"><header className="topbar"><div className="breadcrumbs"><button ref={menuButtonRef} className="icon-button mobile-menu" aria-label="Abrir menú" onClick={() => setMobile(true)}><Menu size={21}/></button><span>Mi taller</span><ChevronRight size={13}/><b>{currentPage.label}</b></div><div className="topbar-right"><span className="mode-chip"><span/>{isSupabaseMode ? 'Mi taller' : 'Modo demo'}</span><span className="header-divider"/><span className="avatar dark">{initials(state.workshop.name)}</span></div></header><main className="main-content"><div className="page-heading"><div><div className="eyebrow">{page === 'dashboard' ? day : 'TU TALLER, EN ORDEN'}</div><h1 tabIndex={-1}>{page === 'dashboard' ? 'Un buen día para tu taller.' : currentPage.label}</h1><p>{currentPage.description}</p></div>{page !== 'reception' && <button className="button primary" onClick={() => navigate('reception')}><Plus size={18}/>Registrar solicitud</button>}</div>{!isSupabaseMode && <div className="demo-strip"><Sparkles size={16}/><span>Estás explorando un taller demo. Tus cambios se guardan en este navegador.</span>{owner && <button onClick={() => setResetOpen(true)}>Restablecer demo</button>}<button onClick={() => { navigate('dashboard'); void load(new DemoRepository(owner ? 'staff' : 'owner')); }}>Probar rol {owner ? 'staff' : 'owner'}</button></div>}{page === 'dashboard' && (isWorkshopEmpty(state) ? <GettingStarted owner={owner} onNavigate={navigate}/> : <><div className="metrics"><Metric icon={Inbox} title="Solicitudes nuevas" value={newCount} detail="Listas para revisar" color="purple"/><Metric icon={CalendarDays} title="Citas próximas" value={state.metrics?.upcoming ?? 0} detail="Tu agenda, al día" color="blue"/><Metric icon={Users} title="Clientes pendientes" value={pendingClients} detail="Esperando tu respuesta" color="orange"/><Metric icon={Check} title="Solicitudes completadas" value={state.metrics?.completed ?? 0} detail="Trabajo bien organizado" color="green"/></div><div className="dashboard-grid"><section className="card requests-card"><div className="card-heading"><div><h2>Últimas solicitudes <span className="count-pill">{state.requests.length}</span></h2><p>De la conversación a tu bandeja.</p></div><button className="text-button" onClick={() => navigate('requests')}>Ver todas<ArrowRight size={16}/></button></div>{requestTable(state.requests.slice(0, 5))}</section><section className="card agenda-card"><div className="card-heading"><div><h2>Próximas citas</h2><p>Un vistazo a lo que viene.</p></div><CalendarDays size={20} className="muted"/></div>{upcoming.length ? upcoming.slice(0, 3).map(appointmentCard) : <Empty title="Agenda despejada">Crea una cita desde una solicitud.</Empty>}<button className="button full" onClick={() => navigate('appointments')}>Abrir agenda<ArrowRight size={16}/></button></section></div><div className="dashboard-bottom"><section className="reception-banner"><span className="banner-icon"><Sparkles size={27}/></span><div><span className="eyebrow">TU RECEPCIÓN DIGITAL</span><h2>Comparte tu enlace<br/>y deja que te escriban.</h2><p>Tus clientes escriben su consulta directamente; tú la recibes ya organizada.</p>{owner ? <button className="button primary" onClick={() => navigate('settings')}>Ver mi enlace de recepción<ArrowRight size={16}/></button> : <button className="button primary" onClick={() => navigate('reception')}>Registrar solicitud<ArrowRight size={16}/></button>}</div><div className="banner-art" aria-hidden="true"><span><MessageSquare size={23}/></span><i/><span><Inbox size={23}/></span><i/><span><CalendarDays size={23}/></span></div></section><section className="card activity-card"><h2>Actividad reciente</h2>{state.requests.slice(0, 3).map(r => <div className="activity" key={r.id}><span><ArrowDownLeft size={16}/></span><div><b>Solicitud de {customer(r.customer_id)?.name}</b><small>{dateLabel(r.created_at, state.workshop.timezone)} · {statusLabels[r.status]}</small></div></div>)}</section></div></>)}
  {page === 'requests' && <section className="card"><div className="list-toolbar"><SearchInput value={search} onChange={value => { setOffset(0); setSearch(value); }} placeholder="Buscar cliente, matrícula o consulta…"/><label className="filter-label">Estado<select value={filter} onChange={e => { setOffset(0); setFilter(e.target.value as RequestStatus | 'all'); }}><option value="all">Todos los estados</option>{statuses.map(s => <option value={s} key={s}>{statusLabels[s]}</option>)}</select></label></div>{requestTable(filteredRequests)}</section>}
  {page === 'customers' && <section className="card"><div className="list-toolbar"><SearchInput value={search} onChange={value => { setOffset(0); setSearch(value); }} placeholder="Buscar nombre o teléfono…"/><button className="button primary" onClick={() => setEditor({ type: 'customer' })}><Plus size={16}/>Nuevo cliente</button></div><div className="entity-grid">{state.customers.filter(c => onPage(c.id)).map(c => <article className="entity-card" key={c.id}><span className="avatar large">{initials(c.name)}</span><h3>{c.name}</h3><a href={'tel:' + c.phone.replace(/\s/g, '')}>{c.phone}</a><p>{state.customer_counts?.[c.id]?.vehicles ?? 0} vehículos · {state.customer_counts?.[c.id]?.requests ?? 0} solicitudes</p>{c.phone_e164 === null && <p className="phone-review">Revisa el teléfono para evitar duplicados.</p>}{c.notes && <p>{c.notes}</p>}<button className="button small" onClick={() => setEditor({ type: 'customer', initial: c })}>Editar cliente</button></article>)}</div>{!state.customers.filter(c => onPage(c.id)).length && <Empty title="No se encontraron clientes"/>}</section>}
  {page === 'vehicles' && <section className="card"><div className="list-toolbar"><SearchInput value={search} onChange={value => { setOffset(0); setSearch(value); }} placeholder="Buscar marca, matrícula o cliente…"/><button className="button primary" onClick={() => setEditor({ type: 'vehicle' })}><Plus size={16}/>Nuevo vehículo</button></div><div className="entity-grid">{state.vehicles.filter(v => onPage(v.id)).map(v => <article className="entity-card" key={v.id}><span className="vehicle-icon"><Car size={28}/></span><h3>{v.brand} {v.model}</h3><span className="plate">{v.plate || 'Sin matrícula'}</span><p>{customer(v.customer_id)?.name}</p><button className="button small" onClick={() => setEditor({ type: 'vehicle', initial: v })}>Editar vehículo</button></article>)}</div>{!state.vehicles.filter(v => onPage(v.id)).length && <Empty title="No se encontraron vehículos"/>}</section>}
  {page === 'conversations' && <section className="card"><div className="list-toolbar"><SearchInput value={search} onChange={value => { setOffset(0); setSearch(value); }} placeholder="Buscar en las conversaciones…"/><span className="muted">{state.conversations.length} conversaciones</span></div>{state.conversations.filter(c => onPage(c.id)).map(c => { const r = state.requests.find(r => r.conversation_id === c.id); return <button key={c.id} className="conversation-row" onClick={() => setConversation(c.id)}><span className="avatar"><MessageSquare size={19}/></span><div><b>{r ? customer(r.customer_id)?.name : 'Recepción'}</b><p>{r?.reason ?? 'Conversación simulada'}</p><small>{dateLabel(c.created_at, state.workshop.timezone)} · Simulador</small></div><ChevronRight size={19}/></button>; })}{!state.conversations.filter(c => onPage(c.id)).length && <Empty title="No hay conversaciones"/>}</section>}
  {page === 'appointments' && <>
    <div className="list-toolbar"><div><h2>Agenda del taller</h2><p className="muted">Zona horaria: {state.workshop.timezone}</p></div><div className="agenda-toolbar-actions"><div className="calendar-mode-toggle" role="group" aria-label="Calendario o lista"><button type="button" className={agendaView === 'calendar' ? 'active' : ''} aria-pressed={agendaView === 'calendar'} onClick={() => setAgendaView('calendar')}>Calendario</button><button type="button" className={agendaView === 'list' ? 'active' : ''} aria-pressed={agendaView === 'list'} onClick={() => setAgendaView('list')}>Lista</button></div><button className="button primary" onClick={() => setEditor({ type: 'appointment' })}><Plus size={16}/>Nueva cita</button></div></div>
    {agendaView === 'list' && <div className="list-toolbar"><SearchInput value={search} onChange={value => { setOffset(0); setSearch(value); }} placeholder="Buscar cliente, matrícula o motivo…"/><label className="filter-label">Estado<select value={filter} onChange={e => { setOffset(0); setFilter(e.target.value as Appointment['status'] | 'all'); }}><option value="all">Todos los estados</option>{appointmentStatuses.map(s => <option value={s} key={s}>{appointmentStatusLabels[s]}</option>)}</select></label></div>}
    {agendaView === 'calendar' && (state.resources?.length ?? 0) > 0 && <div className="list-toolbar"><label className="filter-label">Recurso<select value={calendarResourceFilter} onChange={e => setCalendarResourceFilter(e.target.value)}><option value="all">Todos los recursos</option>{state.resources!.map(r => <option value={r.id} key={r.id}>{r.name}</option>)}</select></label><label className="filter-label">Estado<select value={calendarStatusFilter} onChange={e => setCalendarStatusFilter(e.target.value as Appointment['status'] | 'all')}><option value="all">Todos los estados</option>{appointmentStatuses.map(s => <option value={s} key={s}>{appointmentStatusLabels[s]}</option>)}</select></label></div>}
    {agendaView === 'calendar'
      ? <Calendar state={state} appointments={(loadedCalendarKey === JSON.stringify(calendarQueryFor(calendarAnchor ?? todayISO, calendarMode, state.workshop.timezone)) && state.page_info?.view === 'calendar' ? state.page_info.ids.flatMap(id => state.appointments.filter(a => a.id === id)) : []).filter(a => (calendarResourceFilter === 'all' || a.resource_id === calendarResourceFilter) && (calendarStatusFilter === 'all' || a.status === calendarStatusFilter))} busy={busy} execute={execute} mode={calendarMode} onModeChange={setCalendarMode} anchor={calendarAnchor ?? todayISO} onAnchorChange={setCalendarAnchor} onCreate={(resourceId, startsAt) => setEditor({ type: 'appointment', initialResourceId: resourceId, initialStartsAt: startsAt })} onReprogram={a => setEditor({ type: 'appointment', initial: a })} onCancel={a => setCancelId({ id: a.id, version: a.version, request_version: state!.requests.find(r => r.id === a.request_id)?.version })}/>
      : <section className="card">{state.appointments.length ? (state.page_info?.ids ?? []).flatMap(id => state.appointments.filter(a => a.id === id)).map(appointmentCard) : (search || filter !== 'all' ? <Empty title="No se encontraron citas">Prueba otra búsqueda o cambia el filtro de estado.</Empty> : <Empty title="Tu agenda está lista">Crea una solicitud y asígnale su primera cita.</Empty>)}</section>}
  </>}
  {page === 'reception' && <Reception execute={execute} onCreated={() => { navigate('requests'); setFilter('nueva'); setNotice('Solicitud creada con su cliente, vehículo y conversación'); }}/>}
  {page === 'team' && owner && isSupabaseMode && <Team state={state}/>}
  {page === 'settings' && owner && <><Settings key={state.workshop.version} state={state} execute={execute}/><Hours state={state} execute={execute}/><Resources state={state} execute={execute}/></>}
  {dataLoading && <p role="status" className="data-loading">Actualizando…</p>}
  {['requests','customers','vehicles','conversations','appointments'].includes(page) && state.page_info?.view === page && <div className="pagination"><button className="button" disabled={offset === 0 || dataLoading} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Anterior</button><span>{state.page_info.total ? offset + 1 : 0}–{Math.min(offset + PAGE_SIZE, state.page_info.total)} de {state.page_info.total}</span><button className="button" disabled={offset + PAGE_SIZE >= state.page_info.total || dataLoading} onClick={() => setOffset(offset + PAGE_SIZE)}>Siguiente</button></div>}
  <footer className="footer"><span>TALLERIA · Tu taller, en orden.</span><span>{isSupabaseMode ? 'Datos de tu taller' : 'Prototipo · Recepción simulada'}</span></footer></main></div>
  {notice && <div className="toast" role="status"><Check size={17}/>{notice}</div>}{errorBanner}
  {activeRequest && <Modal title="Detalle de la solicitud" onClose={() => setSelected(null)}><div className="detail-top"><Badge status={activeRequest.status}/><small>{dateLabel(activeRequest.created_at, state.workshop.timezone, true)}</small></div><h3>{customer(activeRequest.customer_id)?.name}</h3><a href={'tel:' + customer(activeRequest.customer_id)?.phone}>{customer(activeRequest.customer_id)?.phone}</a><p className="vehicle-detail"><Car size={18}/>{vehicle(activeRequest.vehicle_id)?.brand} {vehicle(activeRequest.vehicle_id)?.model} · {vehicle(activeRequest.vehicle_id)?.plate || 'Sin matrícula'}</p><dl className="detail-list"><dt>Motivo</dt><dd>{activeRequest.reason}</dd><dt>Disponibilidad</dt><dd>{activeRequest.availability}</dd><dt>Observaciones</dt><dd>{activeRequest.notes || 'Sin observaciones'}</dd></dl><Field label="Estado de la solicitud"><select disabled={busy} value={activeRequest.status} onChange={e => void execute({ type: 'status', version: activeRequest.version, id: activeRequest.id, status: e.target.value as RequestStatus })}>{statuses.map(s => <option key={s} value={s}>{statusLabels[s]}</option>)}</select></Field><div className="detail-actions"><button className="button" onClick={() => { setConversation(activeRequest.conversation_id); setSelected(null); }}><MessageSquare size={16}/>Ver conversación</button>{!['completada', 'cancelada', 'cita_creada'].includes(activeRequest.status) && <button className="button primary" onClick={() => { setEditor({ type: 'appointment', request: activeRequest }); setSelected(null); }}><CalendarDays size={16}/>Crear cita</button>}</div></Modal>}
  {activeConversation && <Modal title="Conversación de recepción" onClose={() => setConversation(null)}><p className="muted">Simulación · {dateLabel(activeConversation.created_at, state.workshop.timezone)}</p><div className="conversation-history">{activeConversation.messages.map((m, i) => <div className={'message ' + m.role} key={i}><small>{m.role === 'assistant' ? 'TALLERIA' : 'Cliente'}</small><p>{m.content}</p></div>)}</div><button className="button full" onClick={() => { setSelected(state.requests.find(r => r.conversation_id === activeConversation.id)?.id ?? null); setConversation(null); }}>Ver solicitud vinculada<ArrowRight size={16}/></button></Modal>}
  {editor?.type === 'customer' && <CustomerEditor state={state} initial={editor.initial} execute={execute} onClose={() => setEditor(null)}/>}
  {editor?.type === 'vehicle' && <VehicleEditor find={find} state={state} initial={editor.initial} execute={execute} onClose={() => setEditor(null)}/>}
  {editor?.type === 'appointment' && <AppointmentEditor find={find} state={state} initial={editor.initial} request={editor.request} initialResourceId={editor.initialResourceId} initialStartsAt={editor.initialStartsAt} execute={execute} onClose={() => setEditor(null)}/>}
  {cancelId && <Modal title="Cancelar cita" onClose={() => setCancelId(null)}><p>La cita quedará cancelada y la solicitud volverá a estar pendiente. ¿Quieres continuar?</p><div className="detail-actions"><button className="button" onClick={() => setCancelId(null)}>Conservar cita</button><button className="button primary" disabled={busy} onClick={async () => { if (await execute({ type: 'appointment_status', ...cancelId, status: 'cancelled' })) setCancelId(null); }}>Confirmar cancelación</button></div></Modal>}
  {resetOpen && <Modal title="Restablecer datos demo" onClose={() => setResetOpen(false)}><p>Se borrarán los cambios de la demo en este navegador y se recuperarán los clientes y solicitudes de ejemplo.</p><div className="detail-actions"><button className="button" onClick={() => setResetOpen(false)}>Conservar cambios</button><button className="button primary" onClick={() => void resetDemo()}>Restablecer demo</button></div></Modal>}</div>;
}
function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (s: string) => void; placeholder: string }) { return <label className="search-input"><Search size={18}/><input aria-label={placeholder} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)}/></label>; }
function Metric({ icon: Icon, title, value, detail, color }: { icon: LucideIcon; title: string; value: number; detail: string; color: string }) { return <section className="card metric"><div><span>{title}</span><span className={'metric-icon ' + color}><Icon size={19}/></span></div><strong>{value.toString().padStart(2, '0')}</strong><small><span className={'metric-dot ' + color}/>{detail}</small></section>; }
