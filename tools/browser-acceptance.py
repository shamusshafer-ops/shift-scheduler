"""tools/browser-acceptance.py — Phase II browser acceptance test.

Drives the page in a real browser with Playwright: autofill handing the week to
the optimizer (in a Web Worker), pause/resume, deny and approve overtime,
choose a listed week, persistence after reload, manual edit and undo, drag and
drop, week transitions, saved weeks, Excel export, publication validation and
the printed publication, Deep mode with cancel, and Use best now. Seeds the
current 13-person roster (fixtures/roster-2026-10-15.json) into a fresh
browser profile; nothing on your own browser is touched.

  pip install playwright && python -m playwright install chromium firefox
  python tools/browser-acceptance.py --browser firefox --out acceptance-firefox
  python tools/browser-acceptance.py --browser chromium --out acceptance-chromium

Options: --html PATH (default: the repository's page), --libs DIR (serve the
CDN libraries from a local node_modules instead of the internet), --chrome PATH
(a Chrome/Chromium executable), --file (open the page as file:// instead of
from a local web server; Chromium under Playwright then sometimes loses
localStorage across a reload, which makes the persistence step fail for
reasons outside the app). Writes report.json and screenshots to --out.
"""
import argparse, json, sys, time, re, pathlib, threading, functools, urllib.parse, http.server
from playwright.sync_api import sync_playwright
REPO = pathlib.Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser()
ap.add_argument('--html', default=str(REPO / 'ShiftScheduler_latest loop.html'))
ap.add_argument('--out', default='acceptance-out')
ap.add_argument('--browser', default='chromium', choices=['chromium', 'firefox'])
ap.add_argument('--libs', default=None)
ap.add_argument('--chrome', default=None)
ap.add_argument('--file', action='store_true')
args = ap.parse_args()
html, out, engine = str(pathlib.Path(args.html).resolve()), pathlib.Path(args.out), args.browser
out.mkdir(parents=True, exist_ok=True)
if args.file: url = 'file://' + html
else:
    page_dir, page_name = str(pathlib.Path(html).parent), pathlib.Path(html).name
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=page_dir))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{server.server_address[1]}/' + urllib.parse.quote(page_name)
NM = pathlib.Path(args.libs) if args.libs else None
LIBS = {} if not NM else {'preact@10.26.0/dist/preact.umd.js': NM/'preact/dist/preact.umd.js', 'preact@10.26.0/hooks/dist/hooks.umd.js': NM/'preact/hooks/dist/hooks.umd.js',
 'lucide@0.344.0/dist/umd/lucide.min.js': NM/'lucide/dist/umd/lucide.min.js', 'exceljs@4.4.0/dist/exceljs.min.js': NM/'exceljs/dist/exceljs.min.js',
 '@babel/standalone@7.27.1/babel.min.js': NM/'@babel/standalone/babel.min.js'}
def seed_script(mode='fast', week='2026-12-06'):
    emps = json.load(open(REPO / 'fixtures' / 'roster-2026-10-15.json'))['employees']
    seed = {'shift_employees': emps, 'shift_settings': {'maxConsecutiveShifts': 6, 'maxConsecutiveNights': 6, 'minRestHours': 8}, 'shift_week_start': week, 'shift_optimizer_mode': mode}
    return "(() => { if (localStorage.getItem('__seeded')) return; const d = %s; for (const [k, v] of Object.entries(d)) localStorage.setItem(k, JSON.stringify(v)); localStorage.setItem('__seeded','1'); })();" % json.dumps(seed)
def route(r):
    u = r.request.url
    for k, f in LIBS.items():
        if k in u: return r.fulfill(path=str(f), content_type='application/javascript')
    if NM and 'fonts.g' in u: return r.fulfill(body='', content_type='text/css')
    return r.continue_()
report = {'engine': engine, 'steps': [], 'page_errors': [], 'console_errors': []}
def step(name, ok, detail=''):
    report['steps'].append({'step': name, 'ok': bool(ok), 'detail': str(detail)[:400]}); print(('PASS ' if ok else 'FAIL ') + name, '-', str(detail)[:300], flush=True)
def guard(name, f):
    try: f()
    except Exception as e: step(name, False, 'exception: ' + str(e).split('\n')[0])

with sync_playwright() as p:
    browser = (p.chromium.launch(executable_path=args.chrome, args=['--no-sandbox']) if args.chrome else p.chromium.launch()) if engine == 'chromium' else p.firefox.launch()
    ctx = browser.new_context(viewport={'width': 1500, 'height': 1100}, accept_downloads=True)
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: report['page_errors'].append(str(e)))
    pg.on('console', lambda m: report['console_errors'].append(m.text) if m.type == 'error' and 'babel' not in m.text.lower() else None)
    # The native save-file picker cannot be driven headless; the page's fallback download is tested.
    pg.route('**/*', route); pg.add_init_script(seed_script('fast')); pg.add_init_script("try { delete window.showSaveFilePicker; window.showSaveFilePicker = undefined; } catch (e) {}"); pg.goto(url)
    pg.wait_for_selector('button:has-text("AUTOFILL")', state='attached', timeout=90000)
    body = lambda: pg.inner_text('body')
    filled = lambda: (re.search(r'FILLED (\d+)/(\d+)', body()) or [None, '?', '?'])
    def filled_text():
        t = pg.evaluate("([...document.querySelectorAll('button')].find(b => /^FILLED/.test((b.innerText || '').trim())) || {}).innerText || ''")
        m = re.search(r'FILLED\s*(\d+)\s*/\s*(\d+)', t); return m.group(1) + '/' + m.group(2) if m else '?'
    def btn(name, exact=True): return pg.get_by_role('button', name=name, exact=exact)
    def wait_for(pred, secs, poll=0.5):
        t = time.time()
        while time.time() - t < secs:
            if pred(): return True
            time.sleep(poll)
        return False
    def approve(manager='Acceptance Test'):
        pg.locator('input[maxlength="120"]').first.fill(manager)
        pg.get_by_text('Approve All', exact=True).first.click()
        pg.locator('button:has-text("PROCEED")').first.click()

    modes = pg.evaluate("[...document.querySelectorAll('select')].map(s => [...s.options].map(o => o.text).join('|')).find(t => t.includes('Deep'))")
    step('page loads; optimizer modes offered', modes == 'Fast draft|Balanced|Deep', modes)
    pg.screenshot(path=str(out / '01-loaded.png'))
    before = filled_text()

    # ── Autofill + optimizer in a Worker; pause/resume while it runs ──
    pg.locator('button:has-text("AUTOFILL")').first.click()
    t0 = time.time()
    saw = wait_for(lambda: btn('Pause').count() > 0 and 'neighborhood rebuilds' in body(), 120, 0.25)
    step('autofill hands the week to the optimizer', saw, f'{time.time() - t0:.0f}s')
    if saw:
        step('optimizer runs in a background worker', 'in this tab' not in body(), 'panel does not say it runs in this tab')
        guard('pause', lambda: (btn('Pause').first.click(), time.sleep(0.8), step('pause', btn('Resume').count() > 0, 'Resume offered')))
        def frozen():
            a = re.search(r'(\d+) neighborhood rebuilds', body()); time.sleep(2.5); b = re.search(r'(\d+) neighborhood rebuilds', body())
            step('paused optimizer does not advance', a and b and a.group(1) == b.group(1), f'{a and a.group(1)} -> {b and b.group(1)}')
        guard('paused optimizer does not advance', frozen)
        guard('resume', lambda: (btn('Resume').first.click(), time.sleep(0.8), step('resume', btn('Pause').count() > 0 or 'Finished' in body(), 'Pause offered again')))
    ok = wait_for(lambda: 'OVERTIME APPROVAL REQUIRED' in body(), 180)
    pg.screenshot(path=str(out / '02-finished.png'))
    txt = body(); i = txt.find('Finished')
    step('optimizer finishes and stages overtime for approval', ok, txt[i:i + 160].replace('\n', ' | ') if i >= 0 else '')
    step('finished week is complete and valid', 'Complete and valid' in txt or 'Proven best' in txt, re.search(r'(Complete and valid[^.]*\.|Proven best[^.]*\.|No complete week[^.]*\.)', txt).group(0) if re.search(r'(Complete and valid[^.]*\.|Proven best[^.]*\.|No complete week[^.]*\.)', txt) else '')
    heads = ' '.join(pg.locator('table th').all_inner_texts()).upper()
    step('Weeks found lists comparison columns', all(h in heads for h in ['OVERTIME', 'MAX OT', 'DOUBLES', 'QUICK', 'SHIFT CHG']), heads[:200])
    step('lower-ranked weeks explain why', 'Ranks below' in txt or 'Equal on every' in txt, (re.search(r'Ranks below[^\n]*', txt) or re.search(r'Equal on every[^\n]*', txt) or [''])[0])

    # ── Deny overtime: the schedule stays unchanged ──
    def deny():
        pg.locator('button:has-text("CANCEL PROPOSAL")').first.click(); time.sleep(1)
        step('denying overtime keeps the schedule unchanged', filled_text() == before and 'OVERTIME APPROVAL REQUIRED' not in body(), f'FILLED {before} -> {filled_text()}')
    guard('deny overtime', deny)

    # ── Choose a listed week; approve overtime ──
    def choose():
        use = pg.locator('button:has-text("Use this week"):not([disabled])')
        step('a listed week can be chosen', use.count() > 0, f'{use.count()} enabled')
        use.first.click()
        wait_for(lambda: 'OVERTIME APPROVAL REQUIRED' in body(), 20)
        approve()
        # Approvals are saved (and verified) before the week is committed.
        wait_for(lambda: 'OVERTIME APPROVAL REQUIRED' not in body(), 30); time.sleep(1.5)
        step('approved week is applied', filled_text().split('/')[0] == filled_text().split('/')[1], f'FILLED {filled_text()}')
    guard('choose and approve', choose)
    pg.screenshot(path=str(out / '03-applied.png'))
    applied = filled_text()

    # ── Persistence ──
    def persist():
        report['storage_before_reload'] = pg.evaluate("Object.fromEntries(Object.keys(localStorage).filter(k => k.startsWith('shift_')).map(k => [k, localStorage.getItem(k).length]))")
        report['active_week_before_reload'] = pg.evaluate("localStorage.getItem('shift_active_week')")
        pg.reload(); pg.wait_for_selector('button:has-text("AUTOFILL")', state='attached', timeout=90000); time.sleep(1.5)
        pg.screenshot(path=str(out / '03b-after-reload.png'))
        report['active_week_after_reload'] = pg.evaluate("localStorage.getItem('shift_active_week')")
        step('schedule persists after reload', filled_text() == applied, f'{applied} -> {filled_text()}')
    guard('persistence', persist)

    # ── Manual edit and undo ──
    def edit():
        removers = pg.locator('button[title="Remove from this shift"]')
        n = removers.count()
        if not n: step('manual edit: remove an assignment', False, 'no remove control found'); return
        removers.first.click(force=True); time.sleep(0.8)
        after = filled_text()
        step('manual edit: remove an assignment', after != applied, f'{applied} -> {after}')
        pg.get_by_title('Undo (Ctrl+Z)').first.click(); time.sleep(0.8)
        step('undo restores it', filled_text() == applied, f'-> {filled_text()}')
    guard('manual edit', edit)

    # ── Drag and drop from the roster onto the grid ──
    def drag():
        # A regular (non-supervisor) duty: the person named in the chip that holds the remove button.
        nameOf = lambda r: pg.evaluate("(b) => { let n = b; for (let i = 0; i < 4 && n; i++) { n = n.parentElement; const m = (n?.innerText || '').match(/[A-Z]\\. [A-Z][a-z]+/); if (m) return m[0]; } return null; }", r.element_handle())
        rms = pg.locator('button[title="Remove from this shift"]')
        k = next(i for i in range(rms.count()) if nameOf(rms.nth(i)) not in (None, 'S. Shafer'))
        rm = rms.nth(k); rm.scroll_into_view_if_needed(); time.sleep(0.3); name = nameOf(rm)
        # Mark the grid cell that holds the duty, so the drop goes back into the same cell.
        pg.evaluate("(b) => { document.querySelectorAll('[data-acc-cell]').forEach(e => e.removeAttribute('data-acc-cell')); let n = b; while (n && !/FULL/.test(n.innerText || '')) n = n.parentElement; if (n) n.setAttribute('data-acc-cell', '1'); }", rm.element_handle())
        rm.click(force=True); time.sleep(0.8)
        b0 = filled_text()
        target = pg.locator('[data-acc-cell] button:has-text("+ Add")').first
        if not target.count(): target = pg.locator('button:has-text("+ Add")').first
        chip = pg.locator(f'span[draggable]:has-text("{name}")').first
        chip.drag_to(target); time.sleep(1)
        pg.screenshot(path=str(out / '03c-after-drop.png'))
        # A manual change to a week with overtime is staged for approval first.
        staged = 'OVERTIME APPROVAL REQUIRED' in body()
        if staged: approve(); wait_for(lambda: 'OVERTIME APPROVAL REQUIRED' not in body(), 30); time.sleep(1)
        step('drag and drop from the roster onto the grid', filled_text() != b0, f'removed {name}: {b0}; dragged back into the open slot' + (' (overtime approval staged and approved)' if staged else '') + f': {filled_text()}')
        if filled_text() == b0: pg.get_by_title('Undo (Ctrl+Z)').first.click(); time.sleep(0.5)
    guard('drag and drop', drag)

    # ── Week transitions ──
    def weeks():
        label = lambda: (re.search(r'Week of \d\d/\d\d', body()) or [''])[0]
        w0 = label(); btn('‹').first.click(); time.sleep(1.5); w1 = label(); f1 = filled_text()
        btn('›').first.click(); time.sleep(1.5); w2 = label()
        step('previous week and back (the live week is kept)', w1 != w0 and w2 == w0 and filled_text() == applied, f'{w0} -> {w1} (FILLED {f1}) -> {w2} (FILLED {filled_text()})')
    guard('week transitions', weeks)

    # ── Saved weeks (history) ──
    def close_modal(title):
        pg.evaluate("""(title) => { const h = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && (e.innerText || '').trim().toUpperCase() === title);
          let n = h; while (n && !n.querySelector('button')) n = n.parentElement;
          while (n) { const b = [...n.querySelectorAll('button')].find(x => /^[✕×]$/.test((x.innerText || '').trim())); if (b) { b.click(); return true; } n = n.parentElement; } return false; }""", title)
    def saved():
        pg.locator('button:has-text("Saved Weeks")').first.click(); time.sleep(0.8)
        pg.locator('input[placeholder^="Name this week"]').first.fill('Acceptance snapshot')
        btn('SAVE').first.click(); time.sleep(0.8)
        pg.screenshot(path=str(out / '04-saved-weeks.png'))
        listed = pg.get_by_text('Acceptance snapshot').count() > 0
        step('saved weeks: save and list a week', listed, 'Acceptance snapshot listed' if listed else 'not listed')
        close_modal('SAVED WEEKS'); time.sleep(0.5)
        step('saved weeks dialog closes', pg.get_by_text('SAVE CURRENT WEEK').count() == 0, '')
    guard('saved weeks', saved)

    # ── Excel export ──
    def excel():
        pg.locator('button:has-text("Export draft Excel")').first.click(); time.sleep(1.5)
        try:
            _excel()
        finally:
            if btn('Close').count(): btn('Close').last.click(); time.sleep(0.5)
    def _excel():
        pg.screenshot(path=str(out / '05-excel-preview.png'))
        dl_btn = pg.get_by_role('button', name=re.compile('^Download Excel')).first
        with pg.expect_download(timeout=30000) as dl:
            dl_btn.click()
        d = dl.value; path = out / d.suggested_filename; d.save_as(str(path))
        step('Excel export: preview, then download a workbook', path.stat().st_size > 2000 and path.suffix in ('.xlsx', '.xls'), f'{d.suggested_filename} {path.stat().st_size} bytes')
        for name in ['Close', 'Cancel']:
            if btn(name).count(): btn(name).last.click(); break
        time.sleep(0.5)
    guard('Excel export', excel)

    # ── Publish validation ──
    def publish():
        pg.get_by_role('button', name=re.compile('Publish$')).first.click(); time.sleep(1.5)
        t = body()
        step('publish dialog lists blocking issues and overtime decisions', 'Publication review' in t and 'Overtime decisions' in t, (re.search(r'\d+ blocking issue\(s\)\.', t) or ['no blocking issues'])[0])
        mgr = pg.locator('label:has-text("Manager name") input').first
        if mgr.count(): mgr.fill('Acceptance Test')
        chk = pg.locator('label:has-text("I verified the saved previous-week record") input').first
        if chk.count(): chk.check()
        time.sleep(0.5)
        boxes = pg.locator('label:has-text("h work +") input[type=checkbox]')
        for k in range(boxes.count()):
            if not boxes.nth(k).is_checked(): boxes.nth(k).check()
        save = pg.locator('button:has-text("Save overtime decisions"):not([disabled])')
        if save.count(): save.first.click(); time.sleep(1)
        pub = pg.locator('button:has-text("Publish validated schedule"):not([disabled])')
        pg.screenshot(path=str(out / '06-publish.png'))
        if not pub.count():
            step('publish a validated week', False, 'publish button disabled: ' + (re.search(r'\d+ blocking issue[^\n]*\n[^\n]*', body()) or [''])[0].replace('\n', ' | ')); return
        pub.first.click(); time.sleep(2)
        step('publish a validated week', 'No saved publications yet' not in body(), (re.search(r'Saved publications[^\n]*\n[^\n]*', body()) or [''])[0].replace('\n', ' | '))
    guard('publish', publish)
    def printing():
        pr = pg.locator('button:has-text("Print saved publication"):not([disabled])')
        if not pr.count():
            step('print layout (saved publication)', False, 'no saved publication to print in this run (see publish dialog)'); return
        with ctx.expect_page(timeout=15000) as pop:
            pr.first.click()
        w = pop.value; w.wait_for_load_state(); time.sleep(0.5)
        w.screenshot(path=str(out / '07-print.png'), full_page=True)
        step('print layout (saved publication)', 'Monday' in w.inner_text('body'), w.inner_text('body')[:120].replace('\n', ' | '))
    guard('print', printing)

    # ── Deep mode, then cancel: the schedule is unchanged ──
    def deep():
        for _ in range(3):
            if btn('Close').count(): btn('Close').last.click(); time.sleep(0.5)
        pg.keyboard.press('Escape'); time.sleep(0.3)
        sel = pg.locator('select:has(option:text("Deep"))').first; sel.select_option(label='Deep'); time.sleep(0.3)
        f0 = filled_text()
        btn('Optimize').first.click()
        ok = wait_for(lambda: 'Deep' in body() and btn('Cancel').count() > 0 and 'neighborhood rebuilds' in body(), 30, 0.25)
        time.sleep(4)
        step('Deep mode runs', ok, (re.search(r'Deep[^\n]{0,80}', body()) or [''])[0])
        pg.locator('button:has-text("Cancel")').first.click(); time.sleep(1.5)
        t = body()
        step('cancel stops the run and keeps the schedule', filled_text() == f0 and 'OVERTIME APPROVAL REQUIRED' not in t, f'FILLED {f0} -> {filled_text()}; ' + (re.search(r'(Cancelled[^\n]{0,100}|cancel[^\n]{0,100})', t) or [''])[0])
    guard('deep mode and cancel', deep)

    # ── Balanced, Use best now ──
    def best_now():
        sel = pg.locator('select:has(option:text("Deep"))').first; sel.select_option(label='Balanced'); time.sleep(0.3)
        btn('Optimize').first.click()
        wait_for(lambda: btn('Use best now').count() > 0 and 'neighborhood rebuilds' in body(), 30, 0.25); time.sleep(6)
        btn('Use best now').first.click()
        ok = wait_for(lambda: 'OVERTIME APPROVAL REQUIRED' in body() or 'Applied' in body() or 'unchanged' in body().lower(), 30)
        step('Use best now stops and applies or stages approval', ok, (re.search(r'(Applied[^\n]{0,100}|OVERTIME APPROVAL REQUIRED|[^\n]*unchanged[^\n]*)', body()) or [''])[0])
        if 'OVERTIME APPROVAL REQUIRED' in body(): approve(); time.sleep(1)
        pg.screenshot(path=str(out / '07-best-now.png'))
    guard('use best now', best_now)

    browser.close()
step('no uncaught page errors', not report['page_errors'], '; '.join(report['page_errors'][:3]))
json.dump(report, open(out / 'report.json', 'w'), indent=1)
print('SUMMARY', sum(s['ok'] for s in report['steps']), 'of', len(report['steps']), 'passed')
