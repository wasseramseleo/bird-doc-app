"""`manage.py ai_visibility [logfile]` — the repo AI-visibility analysis script.

Reads a Caddy JSON access log (a path, or stdin when none is given) and prints
the aggregated AI-visibility signal: AI answer-fetcher hits, general AI-crawler
activity, and human click-throughs referred from AI answer surfaces. All the
work is the pure `landing.ai_visibility` aggregator — this command is only the
file/stdin plumbing, so nothing here needs the database or any client-side
analytics (PRD #300, issue #307).

    manage.py ai_visibility /var/log/caddy/birddoc-access.log
    cat access.log | manage.py ai_visibility
"""

import sys

from django.core.management.base import BaseCommand

from landing.ai_visibility import aggregate_log_lines, render_report


class Command(BaseCommand):
    help = "Aggregate AI answer-fetcher hits and AI referrals from a Caddy JSON access log."

    def add_arguments(self, parser):
        parser.add_argument(
            "logfile",
            nargs="?",
            default=None,
            help="Path to the Caddy JSON access log; omit to read from stdin.",
        )

    def handle(self, *args, **options):
        logfile = options["logfile"]
        if logfile:
            with open(logfile, encoding="utf-8") as handle:
                report = aggregate_log_lines(handle)
        else:
            # The `cat access.log | manage.py ai_visibility` pipe: stream the
            # process stdin line by line, no client-side anything involved.
            report = aggregate_log_lines(sys.stdin)
        self.stdout.write(render_report(report))
