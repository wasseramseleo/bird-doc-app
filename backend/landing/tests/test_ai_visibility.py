"""Server-side AI-visibility measurement (PRD #300, issue #307).

The parse/aggregate half of the measurement is a **pure function over Caddy
JSON access-log lines** — no client-side analytics, no DB, no HTTP. These tests
feed it fixture log lines shaped exactly like Caddy's JSON access log (a
`request` object whose `headers` carry `User-Agent` and `Referer` as lists) and
assert the three buckets the operator cares about: AI answer-fetcher hits
(`ChatGPT-User`/`Perplexity-User`/`Claude-User`), general AI-crawler activity,
and human click-throughs referred from AI answer surfaces — with ordinary
traffic correctly ignored. The Caddyfile `log` directive that produces these
lines is deploy config, verified manually on deploy (see the PR), not here.
"""

import json
from io import StringIO

from django.core.management import call_command

from landing.ai_visibility import aggregate_log_lines


def caddy_line(user_agent="Mozilla/5.0", referer=None, host="birddoc.eu", uri="/", status=200):
    """Build one Caddy JSON access-log line (the shape Caddy actually emits)."""
    headers = {"User-Agent": [user_agent]}
    if referer is not None:
        headers["Referer"] = [referer]
    return json.dumps(
        {
            "level": "info",
            "logger": "http.log.access",
            "msg": "handled request",
            "request": {
                "remote_ip": "203.0.113.7",
                "proto": "HTTP/2.0",
                "method": "GET",
                "host": host,
                "uri": uri,
                "headers": headers,
            },
            "status": status,
        }
    )


def test_chatgpt_user_fetch_is_bucketed_as_an_answer_fetcher():
    # The tracer bullet: a live ChatGPT-User fetch (ChatGPT reading a page on a
    # user's behalf) is counted as an AI answer-fetcher hit under its bot name.
    report = aggregate_log_lines(
        [
            caddy_line(
                user_agent="Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)"
            )
        ]
    )
    assert report.answer_fetcher_hits == {"ChatGPT-User": 1}


def test_all_three_live_fetchers_are_recognised_and_counts_accumulate():
    # All three live user-fetchers are recognised, keyed by bot, and repeated
    # hits from the same bot accumulate.
    report = aggregate_log_lines(
        [
            caddy_line(user_agent="ChatGPT-User/1.0 (+https://openai.com/bot)"),
            caddy_line(user_agent="ChatGPT-User/1.0 (+https://openai.com/bot)"),
            caddy_line(user_agent="Mozilla/5.0 (compatible; Perplexity-User/1.0)"),
            caddy_line(user_agent="Claude-User/1.0 (+Anthropic; claude.ai)"),
        ]
    )
    assert report.answer_fetcher_hits == {
        "ChatGPT-User": 2,
        "Perplexity-User": 1,
        "Claude-User": 1,
    }
    assert report.total_answer_fetcher_hits == 4


def test_ai_crawlers_are_bucketed_separately_from_live_fetchers():
    # General AI-crawler activity (search + training bots) is its own bucket,
    # keyed by bot — distinct from the live answer-fetchers above. A GPTBot
    # index crawl and a PerplexityBot crawl are crawler hits, not fetcher hits.
    report = aggregate_log_lines(
        [
            caddy_line(
                user_agent="Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)"
            ),
            caddy_line(
                user_agent="Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/bot)"
            ),
            caddy_line(
                user_agent="Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)"
            ),
            caddy_line(user_agent="ClaudeBot/1.0 (+https://anthropic.com/claudebot)"),
        ]
    )
    assert report.crawler_hits == {
        "GPTBot": 1,
        "PerplexityBot": 1,
        "OAI-SearchBot": 1,
        "ClaudeBot": 1,
    }
    # The live fetchers are NOT double-counted as crawlers.
    assert report.answer_fetcher_hits == {}
    assert report.total_crawler_hits == 4


def test_referrals_from_ai_answer_surfaces_are_bucketed_by_source_host():
    # A human clicking through from an AI answer arrives with an ordinary
    # browser User-Agent but a Referer on the AI surface's host. Each of the
    # five tracked surfaces is bucketed by its canonical host, and `www.` /
    # deep-path referers still resolve to the same source.
    report = aggregate_log_lines(
        [
            caddy_line(referer="https://chatgpt.com/"),
            caddy_line(referer="https://www.perplexity.ai/search?q=beringungssoftware"),
            caddy_line(referer="https://gemini.google.com/app"),
            caddy_line(referer="https://copilot.microsoft.com/"),
            caddy_line(referer="https://claude.ai/chat/abc-123"),
            caddy_line(referer="https://chatgpt.com/c/deadbeef"),
        ]
    )
    assert report.ai_referrals == {
        "chatgpt.com": 2,
        "perplexity.ai": 1,
        "gemini.google.com": 1,
        "copilot.microsoft.com": 1,
        "claude.ai": 1,
    }
    assert report.total_ai_referrals == 6


def test_ordinary_traffic_is_ignored_by_every_bucket():
    # Human browsers, classic search crawlers and non-AI referrers are ordinary
    # traffic: they belong in no AI bucket at all.
    report = aggregate_log_lines(
        [
            caddy_line(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                referer="https://www.google.com/",
            ),
            caddy_line(
                user_agent="Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
            ),
            caddy_line(user_agent="curl/8.5.0", referer="https://duckduckgo.com/"),
            # A near-miss host must not be counted as an AI referral.
            caddy_line(referer="https://notchatgpt.com/"),
        ]
    )
    assert report.answer_fetcher_hits == {}
    assert report.crawler_hits == {}
    assert report.ai_referrals == {}


def test_malformed_and_non_request_log_lines_are_skipped_gracefully():
    # A real log has blank lines, a truncated/garbage line, and Caddy events
    # that carry no `request` object (TLS handshakes, admin events). None of
    # these may crash the parser or inflate any bucket; the valid AI hit still
    # lands.
    report = aggregate_log_lines(
        [
            "",
            "   ",
            "this is not json at all",
            '{"level":"info","logger":"tls.handshake","msg":"handshake"}',
            "[1, 2, 3]",  # valid JSON, but not an access entry
            caddy_line(user_agent="ChatGPT-User/1.0"),
        ]
    )
    assert report.answer_fetcher_hits == {"ChatGPT-User": 1}
    assert report.crawler_hits == {}
    assert report.ai_referrals == {}


def test_management_command_reads_a_log_file_and_reports_the_signal(tmp_path):
    # The repo script: `manage.py ai_visibility <logfile>` reads a Caddy JSON
    # access log off disk and prints the aggregated signal — the operator's
    # one command, no DB and no client-side analytics involved.
    log = tmp_path / "birddoc-access.log"
    log.write_text(
        "\n".join(
            [
                caddy_line(user_agent="ChatGPT-User/1.0"),
                caddy_line(user_agent="Mozilla/5.0 (compatible; GPTBot/1.2)"),
                caddy_line(referer="https://perplexity.ai/search?q=beringung"),
                caddy_line(user_agent="Mozilla/5.0"),  # ordinary, ignored
            ]
        ),
        encoding="utf-8",
    )

    out = StringIO()
    call_command("ai_visibility", str(log), stdout=out)
    output = out.getvalue()

    assert "ChatGPT-User" in output
    assert "GPTBot" in output
    assert "perplexity.ai" in output


def test_management_command_reads_from_stdin_when_no_path_given(monkeypatch):
    # Piping the log in (`cat access.log | manage.py ai_visibility`) works too,
    # so the log can be streamed from whichever host actually holds it. The pipe
    # is the process stdin — mirror that by patching sys.stdin.
    monkeypatch.setattr("sys.stdin", StringIO(caddy_line(user_agent="Claude-User/1.0")))
    out = StringIO()
    call_command("ai_visibility", stdout=out)
    assert "Claude-User" in out.getvalue()
