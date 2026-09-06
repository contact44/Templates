"""Scenario 1: monthly extraction of the contracts signed in SELMS+.

Skeleton: schedule, credentials and actions are in place; the SELMS+ navigation will be written from the
screen map. Disabled by default until that part exists.
"""

from datetime import date

KEY = "selms_extraction"
NAME = "Monthly SELMS+ extraction"
DESCRIPTION = "On the 28th of each month, exports the contracts signed during the month from SELMS+, checks the file and drops it in the shared folder."
SCHEDULE = "0 7 28 * *"
ENABLED_BY_DEFAULT = False
PARAMS = [
    {"name": "credential", "label": "Vault credential to use", "type": "str", "default": "selms", "help": "Name of the entry under Settings > Credentials."},
    {"name": "shared_folder", "label": "Drop folder", "type": "str", "default": "outputs/selms", "help": "Relative to the workspace, or a full network path."},
    {"name": "month", "label": "Month to extract", "type": "choice", "choices": ["current", "previous"], "default": "current"},
]


def period(choice: str) -> tuple[date, date]:
    today = date.today()
    year, month = today.year, today.month
    if choice == "previous":
        year, month = (year - 1, 12) if month == 1 else (year, month - 1)
    start = date(year, month, 1)
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return start, end


def run(ctx):
    start, end = period(ctx.params["month"])
    ctx.info(f"Period: from {start:%d/%m/%Y} to {end:%d/%m/%Y} (excluded)")
    with ctx.step("web.browse", "SELMS+ · sign in"):
        cred = ctx.credentials(ctx.params["credential"])
        ctx.info(f"Credential '{cred.name}' loaded for user {cred.username}")
        # The navigation (open, filter, export) will be written here from the SELMS+ screen map.
        raise NotImplementedError("SELMS+ screen map pending: the navigation steps are not written yet.")
