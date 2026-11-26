/**
 * The connection check (US-D-1, US-D-6, US-D-8, US-D-32): who the agent is, who owns it, what it may
 * do, which interface version each side speaks, and how notifications reach it. Shared by the
 * `whoami` tool and `wf-agent check`.
 */
import { type Answer, INTERFACE_VERSION, type WfClient } from '@wf/client';
import type { Identity } from './refusal.ts';
import { PLUGIN_VERSION } from './version.ts';

export type Whoami = Answer<'whoami'>;
export type Meta = Answer<'meta_get'>;

export interface PushStatus {
  enabled: boolean;
  connected: boolean;
  channel: string | null;
}

export function identityOf(who: Whoami): Identity {
  return { agentName: who.account.displayName, ownerName: who.owner?.name ?? null, orgName: who.org.name };
}

const CONTACT: Record<string, string> = {
  none: 'may not contact any partner organisation',
  all: 'may contact every partner organisation it works with',
  listed: 'may contact only the listed partner organisations',
};

function limitText(limit: Whoami['limits'][number]): string {
  const parts = [
    limit.templateId ? `template ${limit.templateId}` : 'any template',
    limit.nodeId ? `step ${limit.nodeId}` : null,
    limit.componentKey ? `component ${limit.componentKey}` : null,
  ].filter(Boolean);
  return parts.join(', ');
}

export function notificationText(who: Whoami, push: PushStatus, harness: string): string {
  if (!push.enabled) return 'inbox only (push is turned off with WF_PUSH=off); read it with inbox_read or changes_since';
  if (push.channel && push.connected) {
    return `inbox, plus push: new items are forwarded as ${push.channel} messages (visible in ${harness} sessions that enable the channel); the inbox stays complete`;
  }
  if (push.connected) return 'inbox, plus push: the event stream is open; the inbox stays complete';
  return `inbox only for now (the event stream is not connected; site reports "${who.notification_mode}"); read it with inbox_read or changes_since`;
}

/** Plain lines for a person or an agent to read. */
export function describeIdentity(who: Whoami, meta: Meta | null, site: string, push: PushStatus, harness: string): string[] {
  const roles = who.roles.map((r) => (r.via_group ? `${r.name} (through ${r.via_group.name})` : r.name));
  const lines = [
    `Site: ${site}`,
    `Connected as: ${who.account.displayName} (${who.account.kind === 'agent' ? 'agent' : 'person'}) in ${who.org.name}`,
    `Owner: ${who.owner ? who.owner.name : who.account.kind === 'agent' ? 'none named' : 'not an agent'}`,
    `Roles: ${roles.length ? roles.join(', ') : 'none'}`,
    `Groups: ${who.groups.length ? who.groups.map((g) => g.name).join(', ') : 'none'}`,
    `Limits: ${who.limits.length ? who.limits.map(limitText).join('; ') : 'no extra limit: may act wherever its roles allow'}`,
    `External contact: ${CONTACT[who.external_contact] ?? who.external_contact}${
      who.external_contact === 'listed' && who.contact_orgs.length ? ` (${who.contact_orgs.map((o) => o.name).join(', ')})` : ''
    }`,
    `Paused: ${who.paused ? 'yes. Nothing this agent asks is carried out until its owner resumes it' : 'no'}`,
  ];
  if (who.suspended) lines.push('Suspended: yes. The owner is no longer active; an organisation admin must name a new owner');
  lines.push(
    `Key: ${who.credential.label ?? who.credential.kind}${who.credential.ends_at ? `, valid until ${who.credential.ends_at}` : ''}`,
    `Interface version: site ${meta?.interface_version ?? who.interface_version}, plugin speaks ${INTERFACE_VERSION} (plugin ${PLUGIN_VERSION})`,
    `Notifications: ${notificationText(who, push, harness)}`,
    `Unread in inbox: ${who.unread}`,
  );
  return lines;
}

export async function connectionCheck(client: WfClient) {
  const [who, meta] = await Promise.all([client.call('whoami'), client.call('meta_get')]);
  return { who, meta };
}
