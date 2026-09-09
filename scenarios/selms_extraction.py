"""SELMS+ automation: the scheduled Excel download of My Contract, sent by email.

Written from the scenario sheet "SELMS+ Automation, Scheduled Excel Download" (Legal Operations, July 2026):
    0. SELMS+ is opened from the Knox portal (http://w1.samsung.net/portalapp/home), "SELMS+" in the top menu
    1. that lands on the SELMS+ sign-in page
    2. click "Confirm"
    3. go to "Contract Mgmt." then "My Contract"
    4. Request Date from 01/01/2016 to the end of the current month, "Closed" always "N"
    5. click "Search"
    6. click "Excel Download"
    7. send the file by email to ca.amrat@partner.samsung.com

How the robot drives the site, and why
--------------------------------------
SELMS+ is declared to Edge as an **Internet Explorer mode** site. Edge refuses that mode while remote debugging is
on, and remote debugging is how Playwright and every Chrome-protocol tool drive a browser: under such a tool SELMS+
opens as a blank page. The way in is the Internet Explorer driver attached to Edge, which is Microsoft's supported
route for IE mode sites: it drives the browser through IE automation, not remote debugging, so the mode stays on.

    driver = "edge_ie"  (the default)  needs IEDriverServer.exe, see the README
    driver = "chrome"                  the same code against a normal browser, for testing
    driver = "playwright"              kept for the day SELMS+ leaves IE mode

The file itself is never taken through the browser's download bar, which IE mode cannot be trusted with: the robot
reads the address behind "Excel Download", copies the session cookies out of the browser and fetches the file over
HTTP. Every step leaves a screenshot in the outputs folder, which is what to look at when the site has moved
something. The email leaves through Outlook on the machine, or an SMTP server with a vault credential.
"""

from __future__ import annotations

import calendar
import html as html_entities
import re
import sys
import time
from datetime import date
from pathlib import Path
from urllib.parse import urljoin

KEY = "selms_extraction"
NAME = "SELMS+ Excel download"
DESCRIPTION = ("Signs in to SELMS+ through the Knox portal, opens My Contract, filters the requests from 01/01/2016 "
               "to the end of the current month with Closed = N, downloads the Excel export and sends it by email.")
SCHEDULE = "0 7 28 * *"
ENABLED_BY_DEFAULT = False
PARAMS = [
    {"name": "driver", "label": "How to drive the browser", "type": "choice",
     "choices": ["edge_ie", "playwright", "chrome"], "default": "edge_ie",
     "help": "edge_ie is the Internet Explorer driver attached to Edge, the only thing that opens SELMS+, because the "
             "site needs Internet Explorer mode and Edge turns that mode off for every other automation tool."},
    {"name": "ie_driver_path", "label": "IEDriverServer.exe", "type": "str", "default": "",
     "help": "Where the Internet Explorer driver sits, for example C:\\Pulsar\\IEDriverServer.exe. Leave empty when it "
             "is already on the PATH. See the README to get it."},
    {"name": "portal_url", "label": "Portal to start from", "type": "str", "default": "",
     "help": "Leave empty to go straight to the SELMS+ address below, which is what works in Internet Explorer mode. "
             "Fill it with http://w1.samsung.net/portalapp/home to have the robot click SELMS+ in the portal menu."},
    {"name": "portal_link", "label": "Link to click in the portal menu", "type": "str", "default": "SELMS+",
     "help": "As written in the top menu of the portal. Spaces do not matter."},
    {"name": "url", "label": "SELMS+ address", "type": "str", "default": "http://selmsplus.sec.samsung.net/login.do",
     "help": "The page the portal link lands on."},
    {"name": "recipients", "label": "Send the file to", "type": "str", "default": "ca.amrat@partner.samsung.com",
     "help": "Several addresses separated by ; "},
    {"name": "start_date", "label": "Request Date, from", "type": "str", "default": "2016-01-01",
     "help": "Year-month-day. The end is always the last day of the current month."},
    {"name": "closed", "label": "Closed filter", "type": "choice", "choices": ["N", "Y", "All"], "default": "N"},
    {"name": "browser_path", "label": "Browser executable (optional)", "type": "str", "default": "",
     "help": "Only when the browser is not found by itself, e.g. C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"},
    {"name": "headless", "label": "Headless: run in the background, with no browser window", "type": "bool", "default": False,
     "help": "Internet Explorer mode has no headless: with driver edge_ie the window is always shown and the session "
             "must stay open, so a scheduled run needs the PC awake and signed in. This applies to the other drivers."},
    {"name": "browser_profile", "label": "Browser profile folder", "type": "str", "default": "browser/selms",
     "help": "Relative to the workspace. Keeps the session between runs, for the drivers that support it."},
    {"name": "send_email", "label": "Send the file by email", "type": "bool", "default": True},
    {"name": "smtp_host", "label": "SMTP server (only without Outlook)", "type": "str", "default": "",
     "help": "Used with the 'smtp' credential of the vault when Outlook is not installed on the machine."},
    {"name": "smtp_port", "label": "SMTP port", "type": "int", "default": 587},
    {"name": "screenshots", "label": "Keep a screenshot of each step", "type": "bool", "default": True},
]

FIND_TIMEOUT = 25        # seconds to find a button or a field once the page is there
SEARCH_TIMEOUT = 120     # seconds for SELMS+ to answer the Search: ten years of contracts can take a while
SSO_WAIT = 180           # seconds granted to a human sign-in in the browser window when SSO asks for it


# ---- reading a label as these screens write it -------------------------------------------------------------------

def label_pattern(text: str) -> re.Pattern:
    """The label as it is written, give or take the spacing and the decoration: intranet menus write "SELMS + " for
    SELMS+ and separate their words with &nbsp;, and these forms print a bullet in front of every field name."""
    gap = r"[\s\u00a0]*"
    body = gap.join(re.escape(ch) for ch in text.strip() if not ch.isspace())
    return re.compile(r"^\W*" + body + r"\W*$", re.I)


def looks_like(text: str, label: str) -> bool:
    return bool(label_pattern(label).match(text or ""))


def export_url(page_html: str, base_url: str) -> str | None:
    """The address behind "Excel Download", read out of the page rather than clicked: IE mode cannot be trusted with
    a download bar, so the file is fetched over HTTP with the session cookies instead."""
    for pattern in (r"""["']([^"']*[Ee]xcel[^"']*\.do[^"']*)["']""",
                    r"""["']([^"']*(?:excelDownload|exceldown|downloadExcel)[^"']*)["']"""):
        found = re.search(pattern, page_html)
        if found:
            # the address comes out of the page source, so its & are still written &amp;
            return urljoin(base_url, html_entities.unescape(found.group(1)))
    return None


# ---- the two ways of driving a browser ------------------------------------------------------------------------------

class Session:
    """What the scenario asks of a browser, whichever drives it."""

    def goto(self, url: str) -> None: raise NotImplementedError
    def url(self) -> str: raise NotImplementedError
    def html(self) -> str: raise NotImplementedError
    def text(self) -> str: raise NotImplementedError
    def click(self, label: str, timeout: float = FIND_TIMEOUT) -> bool: raise NotImplementedError
    def hover(self, label: str) -> bool: raise NotImplementedError
    def fields_next_to(self, label: str, kind: str = "input") -> list: raise NotImplementedError
    def set_field(self, field, value: str) -> None: raise NotImplementedError
    def select_field(self, field, value: str) -> None: raise NotImplementedError
    def cookies(self) -> dict: raise NotImplementedError
    def screenshot(self, path: Path) -> None: raise NotImplementedError
    def settle(self, seconds: float = 0.8) -> None: time.sleep(seconds)

    def wait_until_changed(self, before: str, timeout: float) -> bool:
        """Wait for the screen to actually answer. A search over ten years takes its time on the intranet, and the
        page it is written in reloads on its own, so no navigation event says when it is done: the page itself does."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.settle(0.5)
            if self.html() != before:
                return True
        return False
    def close(self) -> None: raise NotImplementedError


class SeleniumSession(Session):
    """Selenium: the Internet Explorer driver attached to Edge for SELMS+, or a plain browser to test the same code."""

    @staticmethod
    def ie_options(browser_path: str = ""):
        """Edge driven in Internet Explorer mode, which is the only mode SELMS+ renders in."""
        from selenium.webdriver.ie.options import Options

        options = Options()
        options.attach_to_edge_chrome = True           # Edge, in Internet Explorer mode
        options.ignore_protected_mode_settings = True  # the zone settings of a corporate PC are rarely uniform
        options.ignore_zoom_level = True               # nor is the zoom always left at 100 %
        options.require_window_focus = False
        if browser_path.strip():
            options.edge_executable_path = browser_path.strip()
        return options

    def __init__(self, kind: str, profile: Path, headless: bool, browser_path: str, ie_driver_path: str):
        from selenium import webdriver

        if kind == "edge_ie":
            from selenium.webdriver.ie.service import Service

            options = self.ie_options(browser_path)
            service = Service(executable_path=ie_driver_path.strip()) if ie_driver_path.strip() else Service()
            self.driver = webdriver.Ie(options=options, service=service)
        else:
            from selenium.webdriver.chrome.options import Options

            options = Options()
            if headless:
                options.add_argument("--headless=new")
            options.add_argument("--no-sandbox")
            options.add_argument(f"--user-data-dir={profile}")
            if browser_path.strip():
                options.binary_location = browser_path.strip()
            self.driver = webdriver.Chrome(options=options)
        self.driver.set_page_load_timeout(SEARCH_TIMEOUT)
        self.driver.implicitly_wait(0)

    # -- what the scenario asks ---------------------------------------------------------------------------------
    def goto(self, url): self.driver.get(url)
    def url(self): return self.driver.current_url
    def html(self): return self._in_every_frame(lambda: self.driver.page_source, join=True)
    def text(self):
        from selenium.webdriver.common.by import By
        try:
            return self.driver.find_element(By.TAG_NAME, "body").text
        except Exception:
            return ""

    def _frames(self):
        """Every frame of the page, the main document first: these screens put their form in one."""
        from selenium.webdriver.common.by import By

        self.driver.switch_to.default_content()
        yield None
        for index in range(len(self.driver.find_elements(By.CSS_SELECTOR, "frame, iframe"))):
            try:
                self.driver.switch_to.default_content()
                frames = self.driver.find_elements(By.CSS_SELECTOR, "frame, iframe")
                self.driver.switch_to.frame(frames[index])
                yield index
            except Exception:
                continue
        self.driver.switch_to.default_content()

    def _in_every_frame(self, work, join=False):
        pieces = []
        for _ in self._frames():
            try:
                found = work()
            except Exception:
                continue
            if found:
                if not join:
                    return found
                pieces.append(found)
        return "\n".join(pieces) if join else None

    def _clickable(self, label):
        from selenium.webdriver.common.by import By

        pattern = label_pattern(label)

        def search():
            for by, how in ((By.CSS_SELECTOR, "button, a, input[type=button], input[type=submit], [role=button]"),
                            (By.XPATH, "//*[not(self::script) and not(self::style) and not(*)]")):
                for element in self.driver.find_elements(by, how):
                    try:
                        if not element.is_displayed():
                            continue
                        for candidate in (element.text, element.get_attribute("value"),
                                          element.get_attribute("aria-label"), element.get_attribute("title")):
                            if candidate and pattern.match(candidate):
                                return element
                    except Exception:
                        continue
            return None

        return self._in_every_frame(search)

    def click(self, label, timeout=FIND_TIMEOUT):
        deadline = time.monotonic() + timeout
        while True:
            element = self._clickable(label)
            if element is not None:
                try:
                    element.click()
                except Exception:
                    self.driver.execute_script("arguments[0].click()", element)
                self.settle()
                return True
            if time.monotonic() > deadline:
                return False
            time.sleep(0.5)

    def hover(self, label):
        from selenium.webdriver.common.action_chains import ActionChains

        element = self._clickable(label)
        if element is None:
            return False
        ActionChains(self.driver).move_to_element(element).perform()
        self.settle(0.4)
        return True

    def fields_next_to(self, label, kind="input"):
        from selenium.webdriver.common.by import By

        pattern = label_pattern(label)

        def search():
            for cell in self.driver.find_elements(By.CSS_SELECTOR, "th, td, label, dt"):
                try:
                    if not pattern.match(cell.text):
                        continue
                except Exception:
                    continue
                for xpath in ("following-sibling::*[1]", "following-sibling::*[2]", "parent::*"):
                    try:
                        fields = cell.find_element(By.XPATH, xpath).find_elements(By.CSS_SELECTOR, kind)
                        fields = [f for f in fields if f.is_displayed()]
                        if fields:
                            return fields
                    except Exception:
                        continue
            return None

        return self._in_every_frame(search) or []

    def set_field(self, field, value):
        editable = not (field.get_attribute("readonly") or field.get_attribute("disabled"))
        if editable:
            try:
                field.clear()
                field.send_keys(value)
                return
            except Exception:
                pass
        # a date driven by a calendar is read-only: set it underneath, and tell the page it changed
        self.driver.execute_script(
            "arguments[0].removeAttribute('readonly'); arguments[0].value = arguments[1];"
            "arguments[0].dispatchEvent(new Event('input', {bubbles: true}));"
            "arguments[0].dispatchEvent(new Event('change', {bubbles: true}));", field, value)

    def select_field(self, field, value):
        from selenium.webdriver.support.ui import Select

        chooser = Select(field)
        try:
            chooser.select_by_value(value)
        except Exception:
            chooser.select_by_visible_text(value or "All")

    def cookies(self):
        return {c["name"]: c["value"] for c in self.driver.get_cookies()}

    def screenshot(self, path):
        self.driver.switch_to.default_content()
        self.driver.save_screenshot(str(path))

    def close(self):
        try:
            self.driver.quit()
        except Exception:
            pass


class PlaywrightSession(Session):
    """Kept for the day SELMS+ leaves Internet Explorer mode: faster, and the only one that can be headless."""

    def __init__(self, profile: Path, headless: bool, browser_path: str):
        from playwright.sync_api import sync_playwright

        profile.mkdir(parents=True, exist_ok=True)
        self._playwright = sync_playwright().start()
        options = dict(user_data_dir=str(profile), headless=headless, accept_downloads=True,
                       viewport={"width": 1400, "height": 900})
        if browser_path.strip():
            options["executable_path"] = browser_path.strip()
        else:
            options["channel"] = "msedge"
        self.context = self._playwright.chromium.launch_persistent_context(**options)
        self.page = self.context.pages[0] if self.context.pages else self.context.new_page()

    def goto(self, url):
        self.page.goto(url, wait_until="domcontentloaded")

    def url(self): return self.page.url
    def html(self): return "\n".join(f.content() for f in self.page.frames)
    def text(self):
        try:
            return self.page.inner_text("body")
        except Exception:
            return ""

    def _everywhere(self, build):
        for frame in self.page.frames:
            try:
                found = build(frame)
                if found.count():
                    return found.first
            except Exception:
                continue
        return None

    def _clickable(self, label):
        pattern = label_pattern(label)
        for build in (lambda f: f.get_by_role("button", name=pattern),
                      lambda f: f.get_by_role("link", name=pattern),
                      lambda f: f.get_by_text(pattern)):
            found = self._everywhere(lambda frame, b=build: b(frame).locator("visible=true"))
            if found is not None:
                return found
        return None

    def click(self, label, timeout=FIND_TIMEOUT):
        deadline = time.monotonic() + timeout
        while True:
            element = self._clickable(label)
            if element is not None:
                before = set(self.context.pages)
                element.click()
                self.settle(0.6)
                opened = [p for p in self.context.pages if p not in before]
                if opened:                       # the portal opens the application in a new tab
                    self.page = opened[-1]
                    self.page.wait_for_load_state("domcontentloaded")
                return True
            if time.monotonic() > deadline:
                return False
            self.page.wait_for_timeout(500)

    def hover(self, label):
        element = self._clickable(label)
        if element is None:
            return False
        element.hover()
        self.settle(0.4)
        return True

    def fields_next_to(self, label, kind="input"):
        pattern = label_pattern(label)
        cell = self._everywhere(lambda f: f.locator("th, td, label, dt", has_text=pattern).first
                                .locator("xpath=following-sibling::*[1]"))
        if cell is None:
            return []
        found = cell.locator(kind)
        return [found.nth(i) for i in range(found.count())]

    def set_field(self, field, value):
        # a read-only field would hold fill() until it times out, so it is set underneath straight away
        if not field.evaluate("el => el.readOnly || el.disabled"):
            try:
                field.fill(value, timeout=3000)
                return
            except Exception:
                pass
        field.evaluate("(el, v) => { el.removeAttribute('readonly'); el.value = v;"
                       "el.dispatchEvent(new Event('input', {bubbles: true}));"
                       "el.dispatchEvent(new Event('change', {bubbles: true})); }", value)

    def select_field(self, field, value):
        try:
            field.select_option(value)
        except Exception:
            field.select_option(label=value or "All")

    def cookies(self):
        return {c["name"]: c["value"] for c in self.context.cookies()}

    def screenshot(self, path):
        self.page.screenshot(path=str(path))

    def settle(self, seconds: float = 0.8):
        self.page.wait_for_timeout(int(seconds * 1000))

    def close(self):
        try:
            self.context.close()
        finally:
            self._playwright.stop()


def open_session(ctx) -> Session:
    kind = ctx.params["driver"]
    profile = ctx.workspace / ctx.params["browser_profile"]
    if kind == "playwright":
        try:
            return PlaywrightSession(profile, ctx.params["headless"], ctx.params["browser_path"])
        except ImportError:
            raise RuntimeError("Playwright is not installed: run  pip install -e .[rpa]") from None
    try:
        return SeleniumSession(kind, profile, ctx.params["headless"], ctx.params["browser_path"],
                               ctx.params["ie_driver_path"])
    except ImportError:
        raise RuntimeError("Selenium is not installed: run  pip install -e .[rpa]") from None
    except Exception as error:
        if kind == "edge_ie":
            raise RuntimeError(
                f"The Internet Explorer driver could not start Edge ({error}). Check that IEDriverServer.exe is where "
                "the parameter says, that it is the 32-bit build, and that Edge is installed. The README says where to "
                "get it and what to set on the PC.") from None
        raise


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


def count_rows(path: Path) -> int:
    """Data rows of the first sheet, the header line excluded."""
    from openpyxl import load_workbook

    book = load_workbook(path, read_only=True)
    try:
        sheet = book.worksheets[0]
        return max(0, sum(1 for row in sheet.iter_rows(values_only=True) if any(v not in (None, "") for v in row)) - 1)
    finally:
        book.close()


# ---- the run ----------------------------------------------------------------------------------------------------------

def run(ctx):
    today = date.today()
    end_date = date(today.year, today.month, calendar.monthrange(today.year, today.month)[1])
    start_date = ctx.params["start_date"].strip()
    stamp = f"{today:%Y-%m-%d}"
    shots = 0

    def shot(session, name: str) -> None:
        nonlocal shots
        if ctx.params["screenshots"]:
            shots += 1
            try:
                session.screenshot(ctx.output_path(f"{stamp}_{shots:02d}_{name}.png"))
            except Exception as error:
                ctx.warn(f"no screenshot for {name}: {error}")

    ctx.info(f"Request Date from {start_date} to {end_date:%Y-%m-%d}, Closed = {ctx.params['closed']}")
    session = open_session(ctx)
    try:
        portal = ctx.params["portal_url"].strip()
        if portal:
            with ctx.step("web.browse", "Opening the Knox portal"):
                session.goto(portal)
                session.settle()
                shot(session, "portal")
                ctx.task_done()

            with ctx.step("web.browse", f"Opening {ctx.params['portal_link']} from the portal"):
                if not session.click(ctx.params["portal_link"]):
                    ctx.warn(f"\"{ctx.params['portal_link']}\" is not in the portal menu: going to {ctx.params['url']}")
                    session.goto(ctx.params["url"])
                shot(session, "sso_check")
                ctx.task_done()
        else:
            with ctx.step("web.browse", "Opening SELMS+"):
                session.goto(ctx.params["url"])
                session.settle()
                shot(session, "sso_check")
                ctx.task_done()

        with ctx.step("web.browse", "Confirming the sign-in"):
            if len((session.text() or "").strip()) < 40 and ctx.params["driver"] != "edge_ie":
                raise RuntimeError(
                    f"{session.url()} came back empty. Edge shows SELMS+ in Internet Explorer mode and will not use "
                    "that mode while a robot drives it through remote debugging. Set the driver to edge_ie.")
            if not session.click("Confirm", timeout=8):
                if ctx.params["headless"]:
                    raise RuntimeError("SELMS+ did not show the Confirm button and the run is headless, so nobody can "
                                       "sign in. Set Headless to no and run once to sign in to SSO by hand.")
                ctx.warn(f"SSO is asking for a sign-in: waiting up to {SSO_WAIT} s for it to be done in the window")
                if not session.click("Confirm", timeout=SSO_WAIT):
                    raise RuntimeError("No sign-in happened in the browser window: the run stops here")
            shot(session, "home")
            ctx.task_done()

        with ctx.step("web.browse", "Opening My Contract"):
            session.hover("Contract Mgmt.")
            if not session.click("My Contract", timeout=6):
                if not session.click("Contract Mgmt."):
                    raise LookupError('The "Contract Mgmt." menu is not on the screen: check the screenshot')
                if not session.click("My Contract"):
                    raise LookupError('"My Contract" is not on the screen: check the screenshot')
            shot(session, "my_contract")
            ctx.task_done()

        with ctx.step("doc.fill", "Setting the filters"):
            dates = session.fields_next_to("Request Date")
            if len(dates) < 2:
                raise LookupError('The "Request Date" field does not show its two dates: check the screenshot')
            session.set_field(dates[0], start_date)
            session.set_field(dates[1], f"{end_date:%Y-%m-%d}")
            closed = session.fields_next_to("Closed", kind="select")
            if not closed:
                raise LookupError('The "Closed" list is not on the screen: check the screenshot')
            session.select_field(closed[0], "" if ctx.params["closed"] == "All" else ctx.params["closed"])
            shot(session, "filters")
            ctx.task_done()

        with ctx.step("web.browse", "Searching"):
            before = session.html()
            if not session.click("Search"):
                raise LookupError('The "Search" button is not on the screen: check the screenshot')
            if not session.wait_until_changed(before, SEARCH_TIMEOUT):
                ctx.warn("the results page did not change after the search: carrying on with what is on screen")
            shot(session, "results")
            ctx.task_done()

        with ctx.step("doc.read", "Downloading the Excel export"):
            target = ctx.output_path(f"{stamp}_my_contracts.xlsx")
            address = export_url(session.html(), session.url())
            if address is None:
                raise LookupError('The address behind "Excel Download" was not found on the results page: check the '
                                  "screenshot of this step")
            ctx.info(f"Export: {address}")
            fetch(address, session.cookies(), target)
            ctx.info(f"Excel file saved: {target} ({target.stat().st_size // 1024} KB)")
            ctx.metric("file", target.name)
            ctx.task_done()
    finally:
        session.close()

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
                f"(Request Date from {start_date} to {end_date:%Y-%m-%d}, Closed = {ctx.params['closed']}): "
                f"{rows} contracts.\n\nSent by Samsung Pulsar.")
        if sys.platform == "win32":
            try:
                send_with_outlook(recipients, subject, body, target)
                ctx.info(f"Sent through Outlook to {recipients}")
                ctx.task_done()
                return
            except ImportError:
                ctx.warn("pywin32 is not installed, Outlook cannot be used: run  pip install -e .[rpa]")
            except Exception as error:
                ctx.warn(f"Outlook could not send the email: {error}")
        if ctx.params["smtp_host"].strip():
            send_with_smtp(ctx, recipients, subject, body, target)
            ctx.info(f"Sent through {ctx.params['smtp_host']} to {recipients}")
            ctx.task_done()
        else:
            ctx.task_failed(f"The email was not sent: no Outlook on this machine and no SMTP server set. "
                            f"The file is in {target.parent}")


def fetch(address: str, cookies: dict, target: Path) -> None:
    """The export itself, over HTTP with the session the browser opened: no download bar to fight with."""
    import urllib.request

    request = urllib.request.Request(address, headers={
        "Cookie": "; ".join(f"{name}={value}" for name, value in cookies.items()),
        "User-Agent": "Mozilla/5.0 (compatible; Samsung Pulsar)",
    })
    with urllib.request.urlopen(request, timeout=SEARCH_TIMEOUT) as answer:
        target.write_bytes(answer.read())
