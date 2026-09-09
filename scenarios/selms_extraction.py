"""SELMS+ automation: the scheduled Excel download of My Contract, sent by email.

Written from the scenario sheet "SELMS+ Automation, Scheduled Excel Download" (Legal Operations, July 2026):
    0. SELMS+ is not reachable by its address alone: the robot starts at the Knox portal
       (http://w1.samsung.net/portalapp/home) and clicks "SELMS+" in the top menu, which is what opens the session
    1. that lands on http://selmsplus.sec.samsung.net/secfw/ssoCheck.do
    2. click "Confirm"
    3. go to "Contract Mgmt." then "My Contract"
    4. set the filter: Request Date from 01/01/2016 to the end of the current month, Closed always "N"
    5. click "Search"
    6. click "Excel Download"
    7. send the file by email to ca.amrat@partner.samsung.com

How the robot drives the site: Microsoft Edge, through Playwright, with a browser profile kept in the workspace so
the Samsung SSO session survives from one run to the next (sign in once by hand in that Edge window, every later
run reuses it). Every screen is located by what is written on it, exactly as the sheet describes it (the "Confirm"
button, the "Contract Mgmt." menu, the "Request Date" and "Closed" labels), inside frames too, so the layout of the
pages does not matter. A screenshot of each step goes to the outputs folder: that is what to look at when a step
fails on the real site.

The email leaves through Outlook on the machine (the robot's own mailbox, nothing to store); without Outlook, an
"smtp" credential from the vault is used; without either the file stays in the outputs folder and the run finishes
with a warning. Needs `pip install -e .[rpa]` (Playwright, openpyxl, pywin32 on Windows).
"""

from __future__ import annotations

import calendar
import re
import sys
import time
from datetime import date
from pathlib import Path

KEY = "selms_extraction"
NAME = "SELMS+ Excel download"
DESCRIPTION = ("Signs in to SELMS+, opens My Contract, filters the requests from 01/01/2016 to the end of the current "
               "month with Closed = N, downloads the Excel export and sends it by email.")
SCHEDULE = "0 7 28 * *"
ENABLED_BY_DEFAULT = False
PARAMS = [
    {"name": "portal_url", "label": "Portal to start from", "type": "str", "default": "http://w1.samsung.net/portalapp/home",
     "help": "SELMS+ is opened from the Knox portal, not by its own address. Leave empty to go straight to the address below."},
    {"name": "portal_link", "label": "Link to click in the portal menu", "type": "str", "default": "SELMS+",
     "help": "As written in the top menu of the portal. Spaces do not matter."},
    {"name": "url", "label": "SELMS+ address", "type": "str", "default": "http://selmsplus.sec.samsung.net/secfw/ssoCheck.do",
     "help": "Used when no portal is set, and as the fallback if the link is not found in the menu."},
    {"name": "recipients", "label": "Send the file to", "type": "str", "default": "ca.amrat@partner.samsung.com",
     "help": "Several addresses separated by ; "},
    {"name": "start_date", "label": "Request Date, from", "type": "str", "default": "2016-01-01", "help": "Year-month-day. The end is always the last day of the current month."},
    {"name": "closed", "label": "Closed filter", "type": "choice", "choices": ["N", "Y", "All"], "default": "N"},
    {"name": "browser", "label": "Browser", "type": "choice", "choices": ["msedge", "chrome", "chromium"], "default": "msedge",
     "help": "Edge is the one signed in to Samsung SSO on a Samsung PC."},
    {"name": "browser_path", "label": "Browser executable (optional)", "type": "str", "default": "",
     "help": "Only when the browser is not found by itself, e.g. C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"},
    {"name": "headless", "label": "Headless: run in the background, with no browser window", "type": "bool", "default": False,
     "help": "No means the browser window is visible and you can watch the robot work; it is also the only way to sign in "
             "to SSO by hand the first time. Yes means the run happens in the background, which is what a scheduled run "
             "should do once the sign-in is remembered."},
    {"name": "browser_profile", "label": "Browser profile folder", "type": "str", "default": "browser/selms",
     "help": "Relative to the workspace. Keeps the SSO session between runs."},
    {"name": "send_email", "label": "Send the file by email", "type": "bool", "default": True},
    {"name": "smtp_host", "label": "SMTP server (only without Outlook)", "type": "str", "default": "",
     "help": "Used with the 'smtp' credential of the vault when Outlook is not installed on the machine."},
    {"name": "smtp_port", "label": "SMTP port", "type": "int", "default": 587},
    {"name": "screenshots", "label": "Keep a screenshot of each step", "type": "bool", "default": True},
]

FIND_TIMEOUT = 25        # seconds to find a button or a field once the page is there
SEARCH_TIMEOUT = 120     # seconds for SELMS+ to answer the Search: ten years of contracts can take a while
SSO_WAIT = 180           # seconds granted to a human sign-in in the browser window when SSO asks for it
DOWNLOAD_TIMEOUT = 180   # seconds for SELMS+ to produce the Excel file


# ---- finding things on the page, in frames too ----------------------------------------------------------------------

def _exact(text: str) -> re.Pattern:
    """The label as it is written, give or take the spacing and the decoration: intranet menus write "SELMS + " for
    SELMS+ and separate their words with &nbsp;, and these forms print a bullet in front of every field name."""
    gap = r"[\s\u00a0]*"
    body = gap.join(re.escape(ch) for ch in text.strip() if not ch.isspace())
    return re.compile(r"^\W*" + body + r"\W*$", re.I)     # \W* also lets through the bullets these forms print


def _everywhere(page, build):
    """The first locator that exists on the page or in any of its frames, or None."""
    for frame in page.frames:
        try:
            loc = build(frame)
            if loc.count():
                return loc.first
        except Exception:
            continue
    return None


def find_clickable(page, text: str, timeout: float = FIND_TIMEOUT):
    """A button, link, image button or plain text reading `text`, wherever it is."""
    builders = [
        lambda f: f.get_by_role("button", name=_exact(text)),
        lambda f: f.get_by_role("link", name=_exact(text)),
        lambda f: f.locator(f'input[type="button"][value="{text}"], input[type="submit"][value="{text}"]'),
        lambda f: f.locator(f'[title="{text}"], img[alt="{text}"]'),
        lambda f: f.get_by_text(_exact(text)),
    ]
    deadline = time.monotonic() + timeout
    while True:
        for build in builders:
            # visible only: a submenu entry hidden under display:none counts as present otherwise, and the robot then
            # clicks something nobody can see instead of opening the menu first
            loc = _everywhere(page, lambda frame, b=build: b(frame).locator("visible=true"))
            if loc is not None:
                return loc
        if time.monotonic() > deadline:
            return None
        page.wait_for_timeout(500)


def click_and_follow(context, page, text: str, timeout: float = FIND_TIMEOUT):
    """Click something that may open the application in a new tab, and return the page to carry on with."""
    loc = find_clickable(page, text, timeout)
    if loc is None:
        return None
    before = set(context.pages)
    loc.click()
    for _ in range(20):                       # a portal link opens its tab in well under ten seconds
        page.wait_for_timeout(500)
        opened = [p for p in context.pages if p not in before]
        if opened:
            fresh = opened[-1]
            fresh.wait_for_load_state("domcontentloaded")
            fresh.bring_to_front()
            return fresh
        if page.url != "about:blank" and page.frames:
            break
    page.wait_for_load_state("domcontentloaded")
    page.wait_for_timeout(600)
    return page


def click(ctx, page, text: str, timeout: float = FIND_TIMEOUT) -> None:
    loc = find_clickable(page, text, timeout)
    if loc is None:
        raise LookupError(f'"{text}" is not on the screen: SELMS+ may have changed, check the screenshot of this step')
    loc.click()
    page.wait_for_load_state("domcontentloaded")
    page.wait_for_timeout(600)


def value_cell(page, label: str):
    """The cell to the right of a form label such as "Request Date" or "Closed"."""
    return _everywhere(page, lambda f: f.locator("th, td, label", has_text=_exact(label)).first.locator("xpath=following-sibling::*[1]"))


def set_value(field, value: str) -> None:
    """Type in a field; date fields driven by a calendar are often read-only, so the value is set underneath then."""
    if field.get_attribute("readonly") is None:
        try:
            field.fill(value, timeout=5000)
            return
        except Exception:
            pass
    field.evaluate("(el, v) => { el.removeAttribute('readonly'); el.value = v; "
                   "el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true})); }", value)


def select_value(field, value: str) -> None:
    try:
        field.select_option(value)
    except Exception:
        field.select_option(label=value)


# ---- the browser ----------------------------------------------------------------------------------------------------

def open_browser(playwright, profile: Path, browser: str, headless: bool, executable: str = ""):
    """A persistent context: the SSO cookies stay in `profile` from one run to the next."""
    profile.mkdir(parents=True, exist_ok=True)
    options = dict(user_data_dir=str(profile), headless=headless, accept_downloads=True, viewport={"width": 1400, "height": 900})
    if executable.strip():
        options["executable_path"] = executable.strip()
    elif browser in ("msedge", "chrome"):
        try:
            return playwright.chromium.launch_persistent_context(channel=browser, **options)
        except Exception as e:  # Edge or Chrome missing on this machine: the bundled Chromium will do, without SSO
            raise RuntimeError(f"{browser} could not be started ({e}). Install it, or choose 'chromium' in the parameters "
                               f"after 'playwright install chromium'.") from e
    return playwright.chromium.launch_persistent_context(**options)


# ---- the email -------------------------------------------------------------------------------------------------------

def send_with_outlook(recipients: str, subject: str, body: str, attachment: Path) -> None:
    import pythoncom          # pywin32, Windows only
    import win32com.client

    pythoncom.CoInitialize()  # the robot runs on a worker thread: COM must be set up on it before Outlook answers
    try:
        outlook = win32com.client.Dispatch("Outlook.Application")
        mail = outlook.CreateItem(0)
        mail.To = recipients
        mail.Subject = subject
        mail.Body = body
        mail.Attachments.Add(str(attachment.resolve()))
        mail.Send()
    finally:
        pythoncom.CoUninitialize()


def send_with_smtp(ctx, recipients: str, subject: str, body: str, attachment: Path) -> None:
    import smtplib
    from email.message import EmailMessage

    cred = ctx.credentials("smtp")
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = cred.username, recipients.replace(";", ","), subject
    msg.set_content(body)
    msg.add_attachment(attachment.read_bytes(), maintype="application",
                       subtype="vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename=attachment.name)
    with smtplib.SMTP(ctx.params["smtp_host"], int(ctx.params["smtp_port"]), timeout=60) as smtp:
        smtp.starttls()
        smtp.login(cred.username, cred.password or "")
        smtp.send_message(msg)


# ---- the run ----------------------------------------------------------------------------------------------------------

def run(ctx):
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise RuntimeError("Playwright is not installed on this machine: run  pip install -e .[rpa]  then  playwright install msedge")

    today = date.today()
    end_date = date(today.year, today.month, calendar.monthrange(today.year, today.month)[1])
    start_date = ctx.params["start_date"].strip()
    stamp = f"{today:%Y-%m-%d}"
    shots = 0

    def shot(page, name: str) -> None:
        nonlocal shots
        if ctx.params["screenshots"]:
            shots += 1
            page.screenshot(path=str(ctx.output_path(f"{stamp}_{shots:02d}_{name}.png")), full_page=False)

    ctx.info(f"Request Date from {start_date} to {end_date:%Y-%m-%d}, Closed = {ctx.params['closed']}")
    with sync_playwright() as playwright:
        context = open_browser(playwright, ctx.workspace / ctx.params["browser_profile"], ctx.params["browser"],
                               ctx.params["headless"], ctx.params["browser_path"])
        try:
            page = context.pages[0] if context.pages else context.new_page()

            portal = ctx.params["portal_url"].strip()
            if portal:
                with ctx.step("web.browse", "Opening the Knox portal"):
                    page.goto(portal, wait_until="domcontentloaded")
                    page.wait_for_timeout(800)
                    shot(page, "portal")
                    ctx.task_done()

                with ctx.step("web.browse", f"Opening {ctx.params['portal_link']} from the portal"):
                    opened = click_and_follow(context, page, ctx.params["portal_link"])
                    if opened is None:
                        ctx.warn(f"\"{ctx.params['portal_link']}\" is not in the portal menu: going to {ctx.params['url']} instead")
                        page.goto(ctx.params["url"], wait_until="domcontentloaded")
                    else:
                        page = opened
                    shot(page, "sso_check")
                    ctx.task_done()
            else:
                with ctx.step("web.browse", "Opening SELMS+"):
                    page.goto(ctx.params["url"], wait_until="domcontentloaded")
                    shot(page, "sso_check")
                    ctx.task_done()

            with ctx.step("web.browse", "Confirming the sign-in"):
                confirm = find_clickable(page, "Confirm", timeout=8)
                if confirm is None:
                    if ctx.params["headless"]:
                        raise RuntimeError("SELMS+ did not show the Confirm button and the run is headless, so nobody can "
                                           "sign in. Set Headless to no, run once and sign in to SSO in the window that "
                                           "opens; the session is then remembered and headless runs work again.")
                    ctx.warn(f"SSO is asking for a sign-in: waiting up to {SSO_WAIT} s for it to be done in the browser window")
                    confirm = find_clickable(page, "Confirm", timeout=SSO_WAIT)
                    if confirm is None:
                        raise RuntimeError("No sign-in happened in the browser window: the run stops here")
                confirm.click()
                page.wait_for_load_state("domcontentloaded")
                page.wait_for_timeout(800)
                shot(page, "home")
                ctx.task_done()

            with ctx.step("web.browse", "Opening My Contract"):
                menu = find_clickable(page, "Contract Mgmt.")
                if menu is None:
                    raise LookupError('The "Contract Mgmt." menu is not on the screen: check the screenshot of this step')
                menu.hover()
                page.wait_for_timeout(400)
                if find_clickable(page, "My Contract", timeout=3) is None:
                    menu.click()
                    page.wait_for_load_state("domcontentloaded")
                click(ctx, page, "My Contract")
                shot(page, "my_contract")
                ctx.task_done()

            with ctx.step("doc.fill", "Setting the filters"):
                cell = value_cell(page, "Request Date")
                if cell is None:
                    raise LookupError('The "Request Date" field is not on the screen: check the screenshot of this step')
                dates = cell.locator("input")
                if dates.count() < 2:
                    raise LookupError("The Request Date field does not show its two dates")
                set_value(dates.nth(0), start_date)
                set_value(dates.nth(1), f"{end_date:%Y-%m-%d}")
                closed = value_cell(page, "Closed")
                if closed is None or not closed.locator("select").count():
                    raise LookupError('The "Closed" list is not on the screen: check the screenshot of this step')
                select_value(closed.locator("select").first, "" if ctx.params["closed"] == "All" else ctx.params["closed"])
                shot(page, "filters")
                ctx.task_done()

            with ctx.step("web.browse", "Searching"):
                # The results must be there before the export is asked for. page.wait_for_load_state() only watches the
                # main document: when the form lives in a frame, as on SELMS+, it returns at once and the robot would
                # click "Excel Download" on the page as it was before the search, exporting the unfiltered list. So the
                # search request itself is awaited, then each frame that reloaded.
                is_search = lambda request: request.resource_type in ("document", "xhr", "fetch")
                with page.expect_request_finished(is_search, timeout=SEARCH_TIMEOUT * 1000):
                    click(ctx, page, "Search")
                for frame in page.frames:
                    try:
                        frame.wait_for_load_state("domcontentloaded")
                    except Exception:            # that frame was replaced while the results came in
                        pass
                page.wait_for_timeout(600)
                shot(page, "results")
                ctx.task_done()

            with ctx.step("doc.read", "Downloading the Excel export"):
                target = ctx.output_path(f"{stamp}_my_contracts.xlsx")
                with page.expect_download(timeout=DOWNLOAD_TIMEOUT * 1000) as pending:
                    click(ctx, page, "Excel Download")
                pending.value.save_as(str(target))
                shot(page, "downloaded")
                ctx.info(f"Excel file saved: {target} ({target.stat().st_size // 1024} KB)")
                ctx.metric("file", str(target))
                ctx.task_done()
        finally:
            context.close()

    with ctx.step("verify", "Checking the file"):
        rows = count_rows(target)
        if rows == 0:
            ctx.task_failed("The Excel export is empty: no contract matched the filter, or the download broke")
        else:
            ctx.info(f"{rows} contracts in the export")
            ctx.task_done()
        ctx.metric("contracts", rows)

    with ctx.step("send", "Sending the file by email"):
        if not ctx.params["send_email"]:
            ctx.info("Email sending is off in the parameters: the file stays in the outputs folder")
            return
        recipients = ctx.params["recipients"].strip()
        subject = f"SELMS+ My Contract export, {today:%d/%m/%Y}"
        body = (f"Hello,\n\nPlease find attached the SELMS+ My Contract export of {today:%d/%m/%Y} "
                f"(Request Date from {start_date} to {end_date:%Y-%m-%d}, Closed = {ctx.params['closed']}): {rows} contracts.\n\n"
                f"Sent by Samsung Pulsar.")
        if sys.platform == "win32":
            try:
                send_with_outlook(recipients, subject, body, target)
                ctx.info(f"Sent through Outlook to {recipients}")
                ctx.task_done()
                return
            except ImportError:
                ctx.warn("pywin32 is not installed, Outlook cannot be used: run  pip install -e .[rpa]")
            except Exception as e:
                ctx.warn(f"Outlook could not send the email: {e}")
        if ctx.params["smtp_host"].strip():
            send_with_smtp(ctx, recipients, subject, body, target)
            ctx.info(f"Sent through {ctx.params['smtp_host']} to {recipients}")
            ctx.task_done()
        else:
            ctx.task_failed(f"The email was not sent: no Outlook on this machine and no SMTP server set. The file is in {target}")


def count_rows(path: Path) -> int:
    """Data rows of the first sheet, the header line excluded."""
    from openpyxl import load_workbook

    book = load_workbook(path, read_only=True)
    try:
        sheet = book.worksheets[0]
        return max(0, sum(1 for row in sheet.iter_rows(values_only=True) if any(v not in (None, "") for v in row)) - 1)
    finally:
        book.close()
