/**
 * Honest refusals (US-D-6). Every refused or failed call is told in words: what happened, why, the
 * missing permission, and who can change it. Paused, revoked, expired, outside limits and site
 * unreachable are distinct messages; none is ever turned into an empty list.
 *
 * When the site names who can change a refusal (`who_can_change`), that is used. For the refusals
 * that are about the agent itself (paused, key revoked or expired, outside limits, contact not
 * allowed, owner inactive) the site may not name anyone, so the plugin names the agent's owner as
 * last read by `whoami`; for an unreachable site it says what to check.
 */
import { isWfError, type Problem, type WfError } from '@wf/client';

export interface Identity {
  agentName: string;
  ownerName: string | null;
  orgName: string | null;
}

const SELF_REFUSALS: Record<string, string> = {
  paused:
    'Your owner{owner} or an organisation admin can resume this agent. Nothing else is needed: the same key works again after resuming.',
  key_revoked: 'Your owner{owner} can issue a new key on the agent page; then give it to this plugin (wf-agent login, or WF_AGENT_KEY).',
  key_expired: 'Your owner{owner} can issue a new key on the agent page; then give it to this plugin (wf-agent login, or WF_AGENT_KEY).',
  outside_limits: 'Your owner{owner} or an organisation admin can change the templates and steps this agent may act on.',
  contact_not_allowed: 'Your owner{owner} or an organisation admin can allow this agent to contact this partner.',
  owner_inactive: 'An organisation admin{org} must name a new owner for this agent.',
  deactivated: 'An organisation admin{org} can reactivate this account.',
  human_required: 'A person must do this step; ask the step owner or reassign it to a person.',
  unauthenticated: 'Check that WF_AGENT_KEY holds the whole key; the agent owner can issue a new one.',
};

function fill(template: string, who: Identity | null): string {
  return template
    .replace('{owner}', who?.ownerName ? ` (${who.ownerName})` : '')
    .replace('{org}', who?.orgName ? ` of ${who.orgName}` : '');
}

/** Plain lines describing a problem, ending with who can change it. */
export function describeProblem(problem: Problem, who: Identity | null, site: string): string[] {
  const lines = [`Refused: ${problem.title}. ${problem.detail}`, `Reason code: ${problem.code}`];
  if (problem.missing_permission) lines.push(`Missing permission: ${problem.missing_permission}`);
  if (problem.unmet?.length) lines.push('Not met yet:', ...problem.unmet.map((u) => `- ${u}`));
  if (problem.errors?.length)
    lines.push('Check these values:', ...problem.errors.map((e) => `- ${e.path || '(whole request)'}: ${e.message}`));
  if (problem.problems?.length) {
    lines.push('Problems of the flow:');
    for (const p of problem.problems)
      lines.push(`- ${String((p as { message?: unknown }).message ?? (p as { code?: unknown }).code ?? '')}`);
  }
  if (problem.who_can_change?.length) {
    lines.push(
      `Who can change this: ${problem.who_can_change.map((w) => `${w.name} (${w.kind === 'account' ? 'person' : w.kind})`).join(', ')}`,
    );
  } else if (problem.code === 'site_unreachable') {
    lines.push(`What to check: the site address (${site}), the network, and whether the site is running (its system admin can tell).`);
    lines.push('This is not an empty queue: nothing was read.');
  } else if (SELF_REFUSALS[problem.code]) {
    lines.push(`Who can change this: ${fill(SELF_REFUSALS[problem.code] ?? '', who)}`);
  }
  return lines;
}

export function describeError(error: unknown, who: Identity | null, site: string): string[] {
  if (isWfError(error)) return describeProblem((error as WfError).problem, who, site);
  const message = error instanceof Error ? error.message : String(error);
  return [`Failed: ${message}`];
}
