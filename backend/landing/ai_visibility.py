"""AI-visibility measurement over Caddy JSON access logs (PRD #300, issue #307).

BirdDoc measures whether AI answer surfaces read and refer to the public
landing without any client-side analytics — no GA4, no consent banner, the
public surface stays script-free (ADR 0009). The signal instead comes from the
server: Caddy writes a structured JSON access log (the `log` directive on the
apex host in the repo `Caddyfile`), and this module is the repo-side analysis
script that aggregates that log.

The parse/aggregate half is a **pure function over log lines**
(`aggregate_log_lines`) with no Django, DB or I/O, so it is unit-tested against
fixture Caddy JSON lines. The thin `ai_visibility` management command wires it to
a file or stdin. The Caddyfile change itself is deploy config, verified manually
on deploy, not in CI.
"""

import json
from collections import Counter
from dataclasses import dataclass
from urllib.parse import urlsplit

# Live AI answer-fetchers: an assistant fetching a page on a user's behalf, in
# real time, to ground its answer. Matched case-insensitively as a substring of
# the User-Agent. These are the highest-value signal — a fetch usually means an
# answer is being composed that could cite BirdDoc right now.
AI_ANSWER_FETCHERS = (
    "ChatGPT-User",
    "Perplexity-User",
    "Claude-User",
)

# General AI crawlers — search-index bots and training-corpus bots. Kept
# allowed on purpose (ADR 0022); here they are only *observed*, not blocked, so
# the operator can see AI-crawler activity on the public surface. The order is
# irrelevant since the fetcher tokens above are checked first and none of these
# is a substring of a fetcher token (so buckets never overlap).
AI_CRAWLERS = (
    "GPTBot",
    "OAI-SearchBot",
    "PerplexityBot",
    "ClaudeBot",
    "Claude-SearchBot",
    "Google-Extended",
    "CCBot",
    "Bytespider",
    "Amazonbot",
    "Applebot-Extended",
    "Meta-ExternalAgent",
    "cohere-ai",
)

# AI answer-surface hosts: a human arriving with a Referer on one of these has
# clicked through from an AI answer. This is the click-through signal, distinct
# from a bot fetch — the visitor is a person, the bot never sends a Referer.
AI_REFERRER_HOSTS = (
    "chatgpt.com",
    "perplexity.ai",
    "gemini.google.com",
    "copilot.microsoft.com",
    "claude.ai",
)


@dataclass(frozen=True)
class AiVisibilityReport:
    """The aggregated AI-visibility signal over a batch of access-log lines."""

    answer_fetcher_hits: dict[str, int]
    crawler_hits: dict[str, int]
    ai_referrals: dict[str, int]

    @property
    def total_answer_fetcher_hits(self):
        return sum(self.answer_fetcher_hits.values())

    @property
    def total_crawler_hits(self):
        return sum(self.crawler_hits.values())

    @property
    def total_ai_referrals(self):
        return sum(self.ai_referrals.values())


def _match_token(user_agent, tokens):
    """Return the first `tokens` entry that appears (case-insensitively) in the
    User-Agent, or ``None``. The canonical token casing is what gets reported."""
    lowered = user_agent.lower()
    for token in tokens:
        if token.lower() in lowered:
            return token
    return None


def _referrer_source(referer):
    """Return the tracked AI answer-surface host a `referer` came from, or None.

    Matches the exact host or any sub-host of a tracked host (so `www.` and
    app sub-domains resolve to the same source), never a mere substring — a
    `notchatgpt.com` referer is not counted.
    """
    host = (urlsplit(referer).hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    for known in AI_REFERRER_HOSTS:
        if host == known or host.endswith("." + known):
            return known
    return None


def aggregate_log_lines(lines):
    """Aggregate the AI-visibility signal from Caddy JSON access-log `lines`.

    Pure over an iterable of strings: each line is one Caddy JSON access entry.
    """
    answer_fetcher_hits = Counter()
    crawler_hits = Counter()
    ai_referrals = Counter()
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except (ValueError, TypeError):
            continue
        if not isinstance(entry, dict):
            continue
        request = entry.get("request")
        if not isinstance(request, dict):
            continue
        headers = request.get("headers") or {}
        user_agent = ""
        referer = ""
        for key, value in headers.items():
            lowered_key = key.lower()
            first = value[0] if isinstance(value, list) and value else (value or "")
            if lowered_key == "user-agent":
                user_agent = first
            elif lowered_key == "referer":
                referer = first
        # Live answer-fetchers win over the general crawler list so the two
        # buckets never overlap (ChatGPT-User is not a GPTBot crawl).
        fetcher = _match_token(user_agent, AI_ANSWER_FETCHERS)
        if fetcher:
            answer_fetcher_hits[fetcher] += 1
        else:
            crawler = _match_token(user_agent, AI_CRAWLERS)
            if crawler:
                crawler_hits[crawler] += 1
        # A referral is an independent signal (a human click-through), so it is
        # counted regardless of the User-Agent bucket above.
        source = _referrer_source(referer)
        if source:
            ai_referrals[source] += 1
    return AiVisibilityReport(
        answer_fetcher_hits=dict(answer_fetcher_hits),
        crawler_hits=dict(crawler_hits),
        ai_referrals=dict(ai_referrals),
    )


def _render_section(title, counts):
    lines = [f"{title} ({sum(counts.values())}):"]
    if not counts:
        lines.append("  (none)")
    for name, count in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])):
        lines.append(f"  {name}: {count}")
    return lines


def render_report(report):
    """Render an `AiVisibilityReport` as plain text for the operator (no colour,
    no client-side anything) — a pure string builder over the aggregated report.
    """
    lines = ["AI-Sichtbarkeit — Caddy-Zugriffslog-Auswertung", ""]
    lines += _render_section("AI-Antwort-Abrufe (Answer-Fetcher)", report.answer_fetcher_hits)
    lines.append("")
    lines += _render_section("AI-Crawler-Aktivität", report.crawler_hits)
    lines.append("")
    lines += _render_section("AI-Verweise (Referrer)", report.ai_referrals)
    return "\n".join(lines)
