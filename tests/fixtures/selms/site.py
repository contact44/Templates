"""A stand-in for SELMS+, the four screens of the scenario sheet: the SSO check with its Confirm button, the menu
"Contract Mgmt." with "My Contract", the My Contract filters (in a frame, as the real one), Search and Excel Download.
Serves on a free local port; records what the robot sent so the test can check it."""

from __future__ import annotations

import io
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

CONTRACTS = [
    ("C-2016-0001", "Frame agreement", "2016-03-02", "N"),
    ("C-2021-0117", "Data processing addendum", "2021-11-09", "N"),
    ("C-2024-0042", "Lease renewal", "2024-05-21", "Y"),
    ("C-2026-0007", "Service agreement", "2026-07-01", "N"),
]

PAGES = {
    "/secfw/ssoCheck.do": """<html><body><h1>SELMS+</h1><p>Legal &amp; PA &nbsp; Camil AMRAT</p>
      <p>This System is strictly restricted to authorized users only.</p>
      <button onclick="location.href='/main.do'">Créer un raccourci</button>
      <button onclick="location.href='/main.do'">Confirm</button></body></html>""",
    "/main.do": """<html><body>
      <div class="menu"><span>About SELMS+</span><span>TCMS</span>
        <span id="cm" onmouseover="document.getElementById('sub').style.display='block'">Contract Mgmt.</span><span>Legal Advice</span></div>
      <div id="sub" style="display:none"><a href="/contract/frame.do">Contract Review</a> · <a href="/contract/frame.do">My Contract</a></div>
      </body></html>""",
    "/contract/frame.do": """<html><body><iframe name="content" src="/contract/myContract.do" width="1200" height="700"></iframe></body></html>""",
}


def my_contract(query: dict) -> str:
    start, end, closed = query.get("start", [""])[0], query.get("end", [""])[0], query.get("closed", ["N"])[0]
    rows = ""
    if "search" in query:
        for cid, title, requested, is_closed in CONTRACTS:
            if start <= requested <= end and (closed == "" or is_closed == closed):
                rows += f"<tr><td>{cid}</td><td>{title}</td><td>{requested}</td><td>{is_closed}</td></tr>"
    sel = lambda v: " selected" if v == closed else ""
    return f"""<html><body><h2>My Contract</h2>
      <form method="get" action="/contract/myContract.do"><table>
      <tr><td>▪ Request Title</td><td><input name="title"></td><td>▪ Contract Title</td><td><input name="ctitle"></td></tr>
      <tr><td>▪ Request Date</td><td><input name="start" readonly value="{start}"> ~ <input name="end" readonly value="{end}"></td>
          <td>▪ Conclusion</td><td><input name="c1" readonly> ~ <input name="c2" readonly></td></tr>
      <tr><td>▪ Step / Status</td><td><select name="step"><option>-- All --</option></select></td>
          <td>▪ Closed</td><td><select name="closed"><option value=""{sel("")}>All</option><option value="N"{sel("N")}>N</option><option value="Y"{sel("Y")}>Y</option></select></td></tr>
      </table>
      <input type="submit" name="search" value="Search">
      </form>
      <input type="button" value="Excel Download" onclick="location.href='/contract/excelDownload.do?start={start}&end={end}&closed={closed}'">
      <table id="results">{rows}</table></body></html>"""


def excel(query: dict) -> bytes:
    from openpyxl import Workbook

    start, end, closed = query.get("start", [""])[0], query.get("end", [""])[0], query.get("closed", ["N"])[0]
    book = Workbook()
    sheet = book.active
    sheet.append(["Contract ID", "Title", "Request Date", "Closed"])
    for cid, title, requested, is_closed in CONTRACTS:
        if start <= requested <= end and (closed == "" or is_closed == closed):
            sheet.append([cid, title, requested, is_closed])
    buffer = io.BytesIO()
    book.save(buffer)
    return buffer.getvalue()


class Handler(BaseHTTPRequestHandler):
    seen: list[str] = []

    def do_GET(self):
        url = urlparse(self.path)
        Handler.seen.append(self.path)
        if url.path in PAGES:
            body, kind = PAGES[url.path].encode(), "text/html; charset=utf-8"
        elif url.path == "/contract/myContract.do":
            body, kind = my_contract(parse_qs(url.query)).encode(), "text/html; charset=utf-8"
        elif url.path == "/contract/excelDownload.do":
            body, kind = excel(parse_qs(url.query)), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            self.send_response(200)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Disposition", 'attachment; filename="MyContract.xlsx"')
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def start() -> tuple[ThreadingHTTPServer, str]:
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}"
