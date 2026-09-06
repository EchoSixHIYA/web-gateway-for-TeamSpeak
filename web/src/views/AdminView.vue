<template>
  <div class="admin-root">
    <div v-if="loading" class="center-card compact"><span class="spinner"></span><p>{{ tr('loading') }}</p></div>

    <main v-else-if="screen === 'change-password'" class="login-page">
      <section class="login-card">
        <div class="admin-brand centered"><span><Icon name="waveform" :size="24" /></span><div><strong>WebSpeak</strong><small>{{ tr('adminConsole') }}</small></div></div>
        <header><h1>{{ tr('changePasswordTitle') }}</h1><p>{{ tr('changePasswordLead') }}</p></header>
        <form @submit.prevent="changePassword"><div v-if="errorMessage" class="alert error">{{ errorMessage }}</div><label><span>{{ tr('newPassword') }}</span><input v-model="newPassword" type="password" autocomplete="new-password" maxlength="1024" autofocus :placeholder="tr('passwordPlaceholder')" /></label><label><span>{{ tr('confirmPassword') }}</span><input v-model="confirmNewPassword" type="password" autocomplete="new-password" maxlength="1024" /></label><div class="strength"><i :style="{ width: `${passwordStrength}%` }"></i></div><button class="primary-button wide" :disabled="submitting" type="submit"><span v-if="submitting" class="spinner small"></span>{{ tr('savePassword') }}</button></form>
        <p class="security-note">{{ tr('defaultCredentialNotice') }}</p><LanguageSwitcher v-model="language" class="language-link" :menu-label="tr('languageMenu')" @change="persistLanguage" />
      </section>
    </main>

    <main v-else-if="screen === 'login'" class="login-page">
      <section class="login-card">
        <div class="admin-brand centered"><span><Icon name="waveform" :size="24" /></span><div><strong>WebSpeak</strong><small>{{ tr('adminConsole') }}</small></div></div>
        <header><h1>{{ tr('welcomeAdmin') }}</h1><p>{{ tr('loginLead') }}</p></header>
        <form @submit.prevent="login"><div v-if="errorMessage" class="alert error">{{ errorMessage }}</div><label><span>{{ tr('adminUsername') }}</span><input v-model.trim="loginUsername" autocomplete="username" autofocus /></label><label><span>{{ tr('adminPassword') }}</span><input v-model="loginPassword" type="password" autocomplete="current-password" /></label><button class="primary-button wide" :disabled="submitting" type="submit"><span v-if="submitting" class="spinner small"></span>{{ tr('login') }}</button></form>
        <div class="login-actions"><RouterLink to="/" class="home-link"><Icon name="home" :size="15" />{{ tr('backHome') }}</RouterLink><LanguageSwitcher v-model="language" class="language-link" :menu-label="tr('languageMenu')" @change="persistLanguage" /></div>
      </section>
    </main>

    <div v-else class="admin-shell">
      <aside class="admin-sidebar">
        <div class="admin-brand"><span><Icon name="waveform" :size="22" /></span><div><strong>WebSpeak</strong><small>{{ tr('adminConsole') }}</small></div></div>
        <nav><RouterLink to="/admin" exact-active-class="active"><Icon name="activity" :size="18" />{{ tr('overview') }}</RouterLink><RouterLink to="/admin/server" active-class="active"><Icon name="server" :size="18" />{{ tr('server') }}</RouterLink><RouterLink to="/admin/operations" active-class="active"><Icon name="users" :size="18" />{{ tr('operations') }}</RouterLink></nav>
        <div class="sidebar-bottom"><a href="/" target="_blank"><Icon name="share" :size="16" />{{ tr('openGuest') }}</a><button type="button" @click="logout"><Icon name="door" :size="16" />{{ tr('logout') }}</button></div>
      </aside>

      <main class="admin-main">
        <header class="admin-topbar"><div><small>{{ tr('adminConsole') }}</small><h1>{{ currentPageTitle }}</h1></div><div><span class="running-dot"></span>{{ tr('gatewayRunning') }}<button type="button" class="theme-toggle" :title="themeLabel" :aria-label="themeLabel" @click="cycleTheme"><Icon :name="themeIcon" :size="17" /><span>{{ themeLabel }}</span></button><LanguageSwitcher v-model="language" :menu-label="tr('languageMenu')" @change="persistLanguage" /></div></header>

        <div v-if="errorMessage" class="alert error page-alert">{{ errorMessage }}</div>
        <section v-if="route.path === '/admin/server'" class="page-content server-page">
          <div class="page-heading"><div><h2>{{ tr('serverSettings') }}</h2><p>{{ tr('serverSettingsLead') }}</p></div><button class="primary-button" :disabled="submitting" @click="saveServerSettings">{{ submitting ? tr('saving') : tr('saveChanges') }}</button></div>
          <div class="settings-grid">
            <article class="settings-card"><h3>{{ tr('teamSpeakTarget') }}</h3><div class="target-fields"><label><span>{{ tr('serverAddress') }}</span><input v-model.trim="serverForm.address" :placeholder="tr('serverPlaceholder')" /></label><label><span>{{ tr('serverPort') }}</span><input v-model.trim="serverForm.port" inputmode="numeric" type="text" maxlength="5" :placeholder="tr('serverPortPlaceholder')" /></label></div><div class="password-row"><label><span>{{ tr('serverPassword') }}</span><input v-model="serverForm.serverPassword" type="password" autocomplete="off" :disabled="serverForm.passwordAction !== 'replace'" :placeholder="serverForm.hasPassword ? tr('passwordConfigured') : tr('optionalPassword')" /></label><div class="password-actions"><button type="button" :class="{ active: serverForm.passwordAction === 'replace' }" @click="serverForm.passwordAction = 'replace'">{{ tr('change') }}</button><button v-if="serverForm.hasPassword" type="button" :class="{ danger: serverForm.passwordAction === 'remove' }" @click="serverForm.passwordAction = 'remove'">{{ tr('remove') }}</button></div></div><button class="secondary-button" type="button" :disabled="testing" @click="testServerConnection"><span v-if="testing" class="spinner small"></span><Icon v-else name="activity" :size="17" />{{ testing ? tr('testing') : tr('testConnection') }}</button><div v-if="testResult" :class="['test-result', testResult.ok ? 'success' : 'error']"><Icon :name="testResult.ok ? 'check' : 'close'" :size="18" /><div><strong>{{ testResult.ok ? tr('connectionReady') : tr('connectionFailed') }}</strong><small>{{ testResultText }}</small></div></div></article>
            <article class="settings-card"><h3>{{ tr('accessAndIdentity') }}</h3><fieldset><legend>{{ tr('accessMode') }}</legend><label class="choice"><input v-model="serverForm.accessMode" type="radio" value="fixed" /><span><strong>{{ tr('fixedMode') }}</strong><small>{{ tr('fixedModeLead') }}</small></span></label><label class="choice"><input v-model="serverForm.accessMode" type="radio" value="open" /><span><strong>{{ tr('openMode') }}</strong><small>{{ tr('openModeLead') }}</small></span></label></fieldset><label><span>{{ tr('siteName') }}</span><input v-model.trim="serverForm.siteName" maxlength="80" /></label><label><span>{{ tr('welcomeTextZh') }}</span><textarea v-model="serverForm.welcomeText" maxlength="500" rows="3"></textarea></label><label><span>{{ tr('welcomeTextEn') }}</span><textarea v-model="serverForm.welcomeTextEn" maxlength="500" rows="3"></textarea></label></article>
            <article class="settings-card advanced-card"><div><h3>{{ tr('advancedSettings') }}</h3><p class="card-help">{{ tr('advancedSettingsLead') }}</p></div><label class="choice toggle-choice"><input v-model="serverForm.webRtcEnabled" type="checkbox" @change="handleWebRtcToggle" /><span><strong>{{ tr('webrtcEnabled') }}</strong><small>{{ tr('webrtcEnabledLead') }}</small></span></label><div class="webrtc-port-fields"><div class="port-fields-heading"><strong>{{ tr('webrtcPortRange') }}</strong><small>{{ tr('webrtcPortRangeLead') }}</small></div><div class="port-inputs"><label><span>{{ tr('webrtcPortStart') }}</span><input v-model.number="serverForm.webRtcUdpStart" type="number" inputmode="numeric" min="1024" max="65535" :disabled="serverForm.webRtcEnabled" /></label><label><span>{{ tr('webrtcPortEnd') }}</span><input v-model.number="serverForm.webRtcUdpEnd" type="number" inputmode="numeric" min="1024" max="65535" :disabled="serverForm.webRtcEnabled" /></label></div></div><small class="field-help">{{ tr('webrtcApplyHint') }}</small></article>
          </div>
          <article class="readonly-card"><h3>{{ tr('runtimeFacts') }}</h3><dl><div><dt>{{ tr('lastTest') }}</dt><dd>{{ formatDate(serverForm.lastTestAt) }}</dd></div><div><dt>{{ tr('latency') }}</dt><dd>{{ serverForm.lastTestLatencyMs == null ? '—' : `${serverForm.lastTestLatencyMs} ms` }}</dd></div><div><dt>{{ tr('internalPort') }}</dt><dd>3040</dd></div></dl></article>
        </section>

        <section v-else-if="route.path === '/admin/operations'" class="page-content operations-page">
          <div class="page-heading"><div><h2>{{ tr('operations') }}</h2><p>{{ tr('operationsLead') }}</p></div><button class="secondary-button" :disabled="operationsLoading" @click="loadOperations"><span v-if="operationsLoading" class="spinner small"></span><Icon v-else name="refresh" :size="17" />{{ tr('refresh') }}</button></div>
          <div class="alert info system-notice"><Icon name="info" :size="16" /><span>{{ tr('updateNotice', { version: operations.diagnostics.version || '—' }) }}</span></div>
          <div class="operations-grid operations-primary">
            <article class="operation-card operation-wide"><header><div><h3>{{ tr('sessions') }}</h3><p>{{ tr('sessionsLead') }}</p></div><strong>{{ operations.sessions.length }}</strong></header><div v-if="operations.sessions.length" class="table-wrap"><table><thead><tr><th>{{ tr('nickname') }}</th><th>{{ tr('sessionState') }}</th><th>{{ tr('age') }}</th><th>{{ tr('memberCount') }}</th><th></th></tr></thead><tbody><tr v-for="session in operations.sessions" :key="session.id"><td><strong>{{ session.nickname }}</strong><small>{{ session.target }}</small></td><td><span class="state-pill">{{ sessionStateLabel(session.state) }}</span></td><td>{{ formatAge(session.ageSeconds) }}</td><td>{{ session.memberCount }}</td><td><button class="danger-button" type="button" :disabled="terminatingSession === session.id" @click="terminateSession(session)">{{ terminatingSession === session.id ? tr('terminating') : tr('endSession') }}</button></td></tr></tbody></table></div><div v-else class="operation-empty"><Icon name="users" :size="22" /><span>{{ tr('sessionEmpty') }}</span></div></article>
            <article class="operation-card"><header><div><h3>{{ tr('invites') }}</h3><p>{{ tr('invitesLead') }}</p></div></header><form class="invite-form" @submit.prevent="createInvite"><label><span>{{ tr('inviteChannel') }}</span><input v-model.trim="inviteForm.channel" maxlength="100" :placeholder="tr('inviteChannelPlaceholder')" /></label><div class="invite-form-grid"><label><span>{{ tr('expiresIn') }}</span><input v-model.number="inviteForm.expiresInHours" type="number" min="1" max="720" /></label><label><span>{{ tr('maxUses') }}</span><input v-model.number="inviteForm.maxUses" type="number" min="0" max="10000" /></label></div><small class="field-help">{{ tr('unlimitedUses') }}</small><button class="primary-button" type="submit" :disabled="submitting"><span v-if="submitting" class="spinner small"></span>{{ tr('createInvite') }}</button></form><div v-if="createdInvite" class="generated-invite"><strong>{{ tr('inviteCreated') }}</strong><div class="generated-link"><input :value="createdInvite.link" readonly /><button class="secondary-button" type="button" @click="copyInviteLink">{{ tr('copyLink') }}</button></div><small>{{ tr('inviteSecurity') }}</small></div><div v-if="operations.invites.length" class="invite-list"><div v-for="invite in operations.invites" :key="invite.id" class="invite-row"><div><strong>{{ invite.channel || tr('defaultChannel') }}</strong><small>{{ invite.target }} · {{ formatDate(invite.expiresAt) }}</small></div><div class="invite-row-meta"><span :class="['state-pill', invite.status]">{{ inviteStatusLabel(invite.status) }}</span><span>{{ invite.useCount }}/{{ invite.maxUses || '∞' }}</span><button v-if="invite.status === 'active'" class="text-danger" type="button" @click="revokeInvite(invite)">{{ tr('revoke') }}</button></div></div></div></article>
          </div>
          <div class="operations-grid lower-operations">
            <article class="operation-card diagnostics-card"><header><div><h3>{{ tr('diagnostics') }}</h3><p>{{ tr('diagnosticsLead') }}</p></div><a class="text-link" href="/api/admin/diagnostics/report">{{ tr('downloadReport') }}</a></header><dl class="diagnostic-list"><div><dt>{{ tr('version') }}</dt><dd>{{ operations.diagnostics.version || '—' }}</dd></div><div><dt>{{ tr('runtime') }}</dt><dd>{{ operations.diagnostics.node || '—' }}</dd></div><div><dt>{{ tr('platform') }}</dt><dd>{{ operations.diagnostics.platform || '—' }} / {{ operations.diagnostics.arch || '—' }}</dd></div><div><dt>{{ tr('databaseSchema') }}</dt><dd>v{{ operations.diagnostics.schemaVersion || '—' }}</dd></div><div><dt>{{ tr('createdSessions') }}</dt><dd>{{ operations.diagnostics.createdSessions }}</dd></div></dl><button class="secondary-button" type="button" @click="downloadBackup">{{ tr('exportBackup') }}</button></article>
            <article class="operation-card logs-card"><header><div><h3>{{ tr('logViewer') }}</h3><p>{{ tr('logViewerLead') }}</p></div><span v-if="!operations.logs.available" class="muted-label">{{ tr('logsUnavailable') }}</span></header><div v-if="operations.logs.sessions.length" class="connection-list"><div class="connection-history-heading"><strong>{{ tr('connectionHistory') }}</strong><small>{{ tr('connectionHistoryLead') }}</small></div><div v-for="record in operations.logs.sessions" :key="record.id" class="connection-row"><div class="connection-person"><strong>{{ record.nickname }}</strong><small>{{ record.target }}</small></div><div class="connection-detail"><span :class="['connection-status', record.status]">{{ connectionStatusLabel(record.status) }}</span><small>{{ record.connectedAt ? tr('connectedAt') : tr('connectionAttemptedAt') }}：{{ formatDate(record.connectedAt || record.startedAt) }}</small><small>{{ tr('duration') }}：{{ formatAge(record.durationSeconds) }}</small><small v-if="record.disconnectedAt">{{ tr('disconnectedAt') }}：{{ formatDate(record.disconnectedAt) }}</small></div></div></div><div v-if="operations.logs.entries.length" class="log-list"><div v-for="(entry, index) in operations.logs.entries" :key="`${entry.timestamp}-${index}`" class="log-row"><span :class="['log-level', entry.level.toLowerCase()]">{{ entry.level }}</span><div><strong>{{ entry.message || '—' }}</strong><small>{{ formatDate(entry.timestamp) }}<template v-if="Object.keys(entry.context).length"> · {{ formatContext(entry.context) }}</template></small></div></div></div><div v-if="!operations.logs.sessions.length && !operations.logs.entries.length" class="operation-empty"><Icon name="activity" :size="22" /><span>{{ tr('noLogs') }}</span></div></article>
            <article class="operation-card audit-card"><header><div><h3>{{ tr('audit') }}</h3><p>{{ tr('auditLead') }}</p></div></header><ul class="event-list"><li v-for="event in operations.audit" :key="`${event.event}-${event.createdAt}`"><span><Icon name="check" :size="14" /></span><div><strong>{{ eventName(event.event) }}</strong><small>{{ formatDate(event.createdAt) }}</small></div></li><li v-if="!operations.audit.length" class="empty-event">{{ tr('auditEmpty') }}</li></ul></article>
          </div>
        </section>

        <section v-else class="page-content overview-page">
          <div v-if="overview.legacyConfigImported" class="alert info import-notice"><span>{{ tr('legacyImported') }}</span><button type="button" @click="dismissLegacyNotice">{{ tr('gotIt') }}</button></div>
          <div class="hero-status"><div><small>{{ tr('systemStatus') }}</small><h2>{{ tr('everythingRunning') }}</h2><p>{{ tr('overviewLead') }}</p></div><span class="status-badge"><i></i>{{ tr('running') }}</span></div>
          <div class="metric-grid"><article><span><Icon name="activity" :size="20" /></span><small>{{ tr('gateway') }}</small><strong>{{ overview.gateway.version || '—' }}</strong><em>{{ formatUptime(overview.gateway.uptimeSeconds) }}</em></article><article><span><Icon name="server" :size="20" /></span><small>{{ tr('teamSpeakTarget') }}</small><strong>{{ overview.teamSpeak.target || '—' }}</strong><em>{{ targetStatusText }}</em></article><article><span><Icon name="users" :size="20" /></span><small>{{ tr('activeSessions') }}</small><strong>{{ overview.sessions.active }} / {{ overview.sessions.limit }}</strong><em>{{ tr('peakSessions', { count: overview.sessions.peak }) }}</em></article></div>
          <div class="overview-columns"><article class="overview-card target-health-card"><header><div><h3>{{ tr('targetHealth') }}</h3><p>{{ tr('targetHealthLead') }}</p></div><RouterLink to="/admin/server">{{ tr('manage') }}</RouterLink></header><dl><div><dt>{{ tr('status') }}</dt><dd><i :class="overview.teamSpeak.status"></i>{{ targetStatusText }}</dd></div><div><dt>{{ tr('lastTest') }}</dt><dd>{{ formatDate(overview.teamSpeak.lastTestAt) }}</dd></div><div><dt>{{ tr('latency') }}</dt><dd>{{ overview.teamSpeak.latencyMs == null ? '—' : `${overview.teamSpeak.latencyMs} ms` }}</dd></div></dl></article><article class="overview-card recent-events-card"><header><div><h3>{{ tr('recentEvents') }}</h3><p>{{ tr('recentEventsLead') }}</p></div></header><ul class="event-list"><li v-for="event in overview.recentEvents" :key="`${event.event}-${event.createdAt}`"><span><Icon name="check" :size="14" /></span><div><strong>{{ eventName(event.event) }}</strong><small>{{ formatDate(event.createdAt) }}</small></div></li><li v-if="!overview.recentEvents.length" class="empty-event">{{ tr('noRecentEvents') }}</li></ul></article></div>
        </section>
        <div v-if="webrtcPortNoticeOpen" class="modal-backdrop" @click.self="webrtcPortNoticeOpen = false"><section class="modal-card" role="dialog" aria-modal="true" :aria-label="tr('webrtcPortNoticeTitle')"><div class="modal-icon"><Icon name="info" :size="21" /></div><h2>{{ tr('webrtcPortNoticeTitle') }}</h2><p>{{ tr('webrtcPortNotice', { range: webrtcPortRangeText }) }}</p><button class="primary-button wide" type="button" @click="webrtcPortNoticeOpen = false">{{ tr('gotIt') }}</button></section></div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import Icon from "../components/Icon.vue";
import LanguageSwitcher from "../components/LanguageSwitcher.vue";
import { combineTeamSpeakTarget, splitTeamSpeakTarget } from "../services/teamspeak-target.js";
import { applyTheme, getStoredTheme, isDarkTheme, nextTheme, saveTheme, type ThemeMode } from "../services/theme.js";

type Language = "zh" | "en" | "de";
type Screen = "login" | "change-password" | "admin";
type AccessMode = "fixed" | "open";
interface ProbeState { ok: boolean; latencyMs?: number; serverName?: string | null; packetLossPercent?: number; attempts?: number; successfulAttempts?: number; code?: string; errorCode?: string }

const route = useRoute();
const router = useRouter();
const storedLanguage = localStorage.getItem("webspeak:language");
const language = ref<Language>(storedLanguage === "en" || storedLanguage === "de" ? storedLanguage : "zh");
const themeMode = ref<ThemeMode>(getStoredTheme());
const themeIcon = computed(() => isDarkTheme(themeMode.value) ? "sun" : "moon");
const themeLabel = computed(() => isDarkTheme(themeMode.value) ? tr("switchToLightTheme") : tr("switchToDarkTheme"));
applyTheme(themeMode.value);
const loading = ref(true);
const screen = ref<Screen>("login");
const csrfToken = ref("");
const submitting = ref(false);
const testing = ref(false);
const errorMessage = ref("");
const loginUsername = ref("admin");
const loginPassword = ref("");
const newPassword = ref("");
const confirmNewPassword = ref("");
const testResult = ref<ProbeState | null>(null);

const serverForm = reactive({ address: "", port: "9987", serverPassword: "", passwordAction: "keep" as "keep" | "replace" | "remove", hasPassword: false, accessMode: "fixed" as AccessMode, siteName: "WebSpeak", welcomeText: "", welcomeTextEn: "", webRtcEnabled: false, webRtcUdpStart: 40000, webRtcUdpEnd: 40099, lastTestAt: null as string | null, lastTestLatencyMs: null as number | null });
const overview = reactive({ gateway: { version: "", uptimeSeconds: 0 }, teamSpeak: { target: "", status: "unknown", lastTestAt: null as string | null, latencyMs: null as number | null }, sessions: { active: 0, peak: 0, limit: 100 }, recentEvents: [] as Array<{ event: string; createdAt: string }>, legacyConfigImported: false });
interface AdminSession { id: string; nickname: string; target: string; state: string; createdAt: string; ageSeconds: number; tsClientId: number | null; channelId: string | null; memberCount: number }
interface ManagedInvite { id: string; target: string; channel: string; expiresAt: string; maxUses: number; useCount: number; createdAt: string; revokedAt: string | null; status: "active" | "expired" | "exhausted" | "revoked" }
interface AdminLog { timestamp: string | null; level: string; message: string; context: Record<string, string | number | boolean> }
interface AdminConnectionRecord { id: string; nickname: string; target: string; startedAt: string; connectedAt: string | null; disconnectedAt: string | null; durationSeconds: number; status: "active" | "connecting" | "disconnected" | "failed"; reason: string | null }
const operationsLoading = ref(false);
const terminatingSession = ref("");
const inviteForm = reactive({ channel: "", expiresInHours: 24, maxUses: 0 });
const createdInvite = ref<{ token: string; link: string } | null>(null);
const webrtcPortNoticeOpen = ref(false);
const operations = reactive({ sessions: [] as AdminSession[], invites: [] as ManagedInvite[], diagnostics: { version: "", node: "", platform: "", arch: "", schemaVersion: 0, createdSessions: 0 }, logs: { available: false, entries: [] as AdminLog[], sessions: [] as AdminConnectionRecord[] }, audit: [] as Array<{ event: string; createdAt: string }> });

const copy = {
  zh: {
    loading: "正在载入管理控制台…",
    adminConsole: "管理控制台",
    changePasswordTitle: "首次登录需要修改密码",
    changePasswordLead: "默认密码仅用于首次登录。请设置一个至少 12 个字符的新管理员密码。",
    savePassword: "保存新密码",
    defaultCredentialNotice: "默认账号：admin，默认密码：admin。修改后旧密码将立即失效。",
    adminUsername: "管理员账号",
    newPassword: "新管理员密码",
    passwordPlaceholder: "至少 12 个字符",
    passwordHint: "建议使用长且唯一的密码。",
    confirmPassword: "确认管理员密码",
    languageMenu: "语言",
    languageSwitch: "English",
    themeSystem: "跟随系统",
    themeLight: "浅色主题",
    themeDark: "深色主题",
    switchToLightTheme: "切换到浅色主题",
    switchToDarkTheme: "切换到深色主题",
    welcomeAdmin: "欢迎回来",
    loginLead: "输入管理员账号和密码以管理此 WebSpeak 实例。",
    adminPassword: "管理员密码",
    login: "登录",
    backHome: "返回首页",
    overview: "概览",
    server: "服务器",
    operations: "运维",
    openGuest: "打开访客页面",
    logout: "退出登录",
    gatewayRunning: "网关运行中",
    serverSettings: "服务器设置",
    serverSettingsLead: "管理默认 TeamSpeak 目标、访问策略和访客页面内容。",
    saving: "正在保存…",
    saveChanges: "保存更改",
    teamSpeakTarget: "默认 TeamSpeak 目标",
    serverAddress: "TeamSpeak 服务器地址",
    serverPlaceholder: "例如：ts.example.com 或 127.0.0.1",
    serverPort: "语音端口",
    serverPortPlaceholder: "9987",
    serverHint: "请分别填写服务器地址和语音端口；IPv6 地址可直接填写，不需要方括号。",
    serverPassword: "服务器密码",
    optional: "可选",
    optionalPassword: "无密码则留空",
    passwordConfigured: "已配置密码（留空保持不变）",
    change: "修改",
    remove: "移除",
    testConnection: "测试连接",
    testing: "正在测试…",
     connectionReady: "连接成功",
     connectionFailed: "连接失败",
     packetLoss: "丢包率",
    accessAndIdentity: "访问与站点信息",
    advancedSettings: "高级参数",
    advancedSettingsLead: "仅在需要时调整网关的高级传输参数。",
    webrtcSettings: "WebRTC 语音",
    webrtcLead: "由当前 WebSpeak 网关直接提供低延迟语音传输，无需配置其他服务器。",
    webrtcEnabled: "启用 WebRTC",
    webrtcEnabledLead: "浏览器和网络支持时使用实时语音通道，否则自动回退到兼容模式。",
    webrtcPortRange: "WebRTC UDP 端口范围",
    webrtcPortRangeLead: "请在 WebSpeak 所在主机的防火墙和安全组放行整个范围。",
    webrtcPortStart: "起始端口",
    webrtcPortEnd: "结束端口",
    webrtcApplyHint: "端口范围仅可在 WebRTC 关闭时修改；开启后会锁定，保存后对新连接生效。",
    webrtcPortNoticeTitle: "请先放行 WebRTC 端口",
    webrtcPortNotice: "需要开启端口，范围是 {{range}}（UDP）。请先在主机防火墙、安全组和 Docker 端口映射中放行该范围。",
    accessMode: "访客访问模式",
    fixedMode: "仅限此 TeamSpeak 服务器",
    fixedModeLead: "访客只需填写昵称，目标和密码由 WebSpeak 管理。",
    openMode: "允许访客输入其他服务器",
    openModeLead: "访客可输入公网 TeamSpeak 地址；内网和保留地址会被阻止。",
    siteName: "站点显示名称",
    welcomeText: "公告",
    welcomeTextZh: "中文公告",
    welcomeTextEn: "英文公告",
    runtimeFacts: "运行时信息",
    lastTest: "最近测试",
    latency: "延迟",
    internalPort: "内部端口",
    unknown: "未知",
    legacyImported: "已导入旧 config.json。WebSpeak 现在由管理控制台管理，原文件不会再作为实时配置源。",
    gotIt: "知道了",
    systemStatus: "系统状态",
    everythingRunning: "WebSpeak 正常运行",
    overviewLead: "管理服务可用；TeamSpeak 可达性以最近一次连接测试为准。",
    running: "运行中",
    gateway: "网关",
    activeSessions: "活动会话",
    peakSessions: "本次启动峰值 {{count}}",
    targetHealth: "目标状态",
    targetHealthLead: "最近一次短连接测试的结果。",
    manage: "管理",
    status: "状态",
    recentEvents: "最近事件",
    recentEventsLead: "仅记录管理和系统事件，不包含聊天内容。",
    noRecentEvents: "暂无事件",
    reachable: "可连接",
    unreachable: "不可连接",
    notTested: "尚未测试",
    setupPasswordsMismatch: "两次输入的密码不一致。",
    setupPasswordShort: "管理员密码至少需要 12 个字符。",
    invalidPassword: "管理员密码错误。",
    rateLimited: "尝试次数过多，请稍后再试。",
    requestFailed: "请求失败，请检查输入后重试。",
    loginEvent: "管理员登录成功",
    logoutEvent: "管理员退出登录",
    settingsEvent: "服务器设置已更新",
    initializedEvent: "默认管理员账号已创建",
    importedEvent: "已导入旧配置",
    testEvent: "连接测试完成",
    operationsLead: "无需登录服务器终端即可完成日常维护和问题定位。",
    refresh: "刷新",
    sessions: "活动会话",
    sessionsLead: "查看当前浏览器连接，并在必要时安全断开单个会话。",
    sessionEmpty: "当前没有活动会话。",
    nickname: "昵称",
    sessionState: "状态",
    age: "持续时间",
    memberCount: "成员数",
    endSession: "断开",
    terminating: "断开中…",
    sessionTerminated: "会话已断开。",
    confirmTerminate: "确定断开「{{nickname}}」吗？",
    invites: "受控邀请",
    invitesLead: "创建可过期、可限次的邀请链接；链接中不包含服务器密码。",
    inviteChannel: "目标频道",
    inviteChannelPlaceholder: "留空使用默认频道",
    expiresIn: "有效期（小时）",
    maxUses: "最多使用次数",
    unlimitedUses: "填写 0 表示不限次数。",
    createInvite: "创建邀请链接",
    inviteCreated: "邀请链接已创建",
    inviteSecurity: "请立即复制并分享链接。出于安全原因，页面不会再次显示完整令牌。",
    copyLink: "复制链接",
    copiedLink: "邀请链接已复制。",
    defaultChannel: "默认频道",
    revoke: "撤销",
    inviteRevoked: "邀请链接已撤销。",
    confirmRevoke: "确定撤销这个邀请链接吗？",
    active: "有效",
    expired: "已过期",
    exhausted: "已用尽",
    revoked: "已撤销",
    diagnostics: "诊断信息",
    diagnosticsLead: "用于反馈问题的运行时摘要；导出的报告会自动脱敏。",
    runtime: "运行时",
    platform: "平台",
    databaseSchema: "数据库版本",
    createdSessions: "累计会话",
    downloadReport: "下载诊断报告",
    exportBackup: "导出数据库备份",
    logViewer: "运行日志",
    logViewerLead: "最近的网关日志及用户连接记录，不包含聊天内容。",
    connectionHistory: "用户连接记录",
    connectionHistoryLead: "按用户合并连接、断开与持续时间。",
    connectionActive: "连接中",
    connectionConnecting: "准备连接",
    connectionDisconnected: "已断开",
    connectedAt: "接入",
    connectionAttemptedAt: "尝试",
    disconnectedAt: "断开",
    duration: "时长",
    logsUnavailable: "未配置日志文件",
    noLogs: "暂无可查看日志。",
    operationFailed: "运维操作失败，请稍后重试。",
    updateNotice: "当前运行版本为 {{version}}。如需升级，请先导出备份，再按部署文档替换应用版本。",
    version: "版本",
    audit: "审计记录",
    auditLead: "管理员和系统操作记录，不包含聊天内容或敏感值。",
    auditEmpty: "暂无审计记录。",
  },
  en: {
    loading: "Loading the admin console…",
    adminConsole: "Admin Console",
    changePasswordTitle: "Change the default password",
    changePasswordLead: "The default password is for first sign-in only. Set a new admin password with at least 12 characters.",
    savePassword: "Save new password",
    defaultCredentialNotice: "Default account: admin. Default password: admin. The old password expires immediately after you save.",
    adminUsername: "Admin username",
    newPassword: "New admin password",
    passwordPlaceholder: "At least 12 characters",
    passwordHint: "Use a long, unique password.",
    confirmPassword: "Confirm admin password",
    languageMenu: "Language",
    languageSwitch: "中文",
    themeSystem: "System theme",
    themeLight: "Light theme",
    themeDark: "Dark theme",
    switchToLightTheme: "Switch to light theme",
    switchToDarkTheme: "Switch to dark theme",
    welcomeAdmin: "Welcome back",
    loginLead: "Enter the admin account and password to manage this WebSpeak instance.",
    adminPassword: "Admin password",
    login: "Sign in",
    backHome: "Back to home",
    overview: "Overview",
    server: "Server",
    operations: "Operations",
    openGuest: "Open guest page",
    logout: "Log out",
    gatewayRunning: "Gateway running",
    serverSettings: "Server settings",
    serverSettingsLead: "Manage the default TeamSpeak target, access policy, and guest-facing content.",
    saving: "Saving…",
    saveChanges: "Save changes",
    teamSpeakTarget: "Default TeamSpeak target",
    serverAddress: "TeamSpeak server address",
    serverPlaceholder: "e.g. ts.example.com or 127.0.0.1",
    serverPort: "Voice port",
    serverPortPlaceholder: "9987",
    serverHint: "Enter the server address and voice port separately. IPv6 addresses do not need brackets.",
    serverPassword: "Server password",
    optional: "Optional",
    optionalPassword: "Leave blank when unused",
    passwordConfigured: "Password configured (leave blank to keep it)",
    change: "Change",
    remove: "Remove",
    testConnection: "Test connection",
    testing: "Testing…",
     connectionReady: "Connection ready",
     connectionFailed: "Connection failed",
     packetLoss: "Packet loss",
    accessAndIdentity: "Access and site identity",
    advancedSettings: "Advanced settings",
    advancedSettingsLead: "Adjust gateway transport options only when needed.",
    webrtcSettings: "WebRTC audio",
    webrtcLead: "Low-latency voice is provided by this WebSpeak gateway; no extra server is required.",
    webrtcEnabled: "Enable WebRTC",
    webrtcEnabledLead: "Use realtime audio when supported; browsers and networks fall back automatically.",
    webrtcPortRange: "WebRTC UDP port range",
    webrtcPortRangeLead: "Allow the complete range through the host firewall and security group.",
    webrtcPortStart: "Start port",
    webrtcPortEnd: "End port",
    webrtcApplyHint: "The range can only be edited while WebRTC is off. It is locked while enabled and applies to new connections after saving.",
    webrtcPortNoticeTitle: "Allow WebRTC ports first",
    webrtcPortNotice: "Ports must be opened: {{range}} (UDP). Allow this range in the host firewall, security group, and Docker port mapping first.",
    accessMode: "Guest access mode",
    fixedMode: "Only this TeamSpeak server",
    fixedModeLead: "Guests enter only a nickname; WebSpeak manages the target and password.",
    openMode: "Allow other TeamSpeak servers",
    openModeLead: "Guests may enter public TeamSpeak addresses; private and reserved networks are blocked.",
    siteName: "Site display name",
    welcomeText: "Announcement",
    welcomeTextZh: "Chinese announcement",
    welcomeTextEn: "English announcement",
    runtimeFacts: "Runtime facts",
    lastTest: "Last test",
    latency: "Latency",
    internalPort: "Internal port",
    unknown: "Unknown",
    legacyImported: "Legacy config.json was imported. WebSpeak is now managed here and the old file is no longer a live configuration source.",
    gotIt: "Got it",
    systemStatus: "SYSTEM STATUS",
    everythingRunning: "WebSpeak is running",
    overviewLead: "The management service is available. TeamSpeak reachability reflects the latest connection test.",
    running: "Running",
    gateway: "Gateway",
    activeSessions: "Active sessions",
    peakSessions: "Peak this run: {{count}}",
    targetHealth: "Target health",
    targetHealthLead: "Result of the latest short-lived connection test.",
    manage: "Manage",
    status: "Status",
    recentEvents: "Recent events",
    recentEventsLead: "Only system and admin events are recorded; chat content is excluded.",
    noRecentEvents: "No recent events",
    reachable: "Reachable",
    unreachable: "Unreachable",
    notTested: "Not tested",
    setupPasswordsMismatch: "The two passwords do not match.",
    setupPasswordShort: "The admin password must be at least 12 characters.",
    invalidPassword: "The admin password is incorrect.",
    rateLimited: "Too many attempts. Try again later.",
    requestFailed: "The request failed. Check the fields and try again.",
    loginEvent: "Administrator signed in",
    logoutEvent: "Administrator signed out",
    settingsEvent: "Server settings changed",
    initializedEvent: "Default administrator account created",
    importedEvent: "Legacy configuration imported",
    testEvent: "Connection test completed",
    operationsLead: "Handle routine maintenance and troubleshooting without shell access.",
    refresh: "Refresh",
    sessions: "Active sessions",
    sessionsLead: "Inspect browser connections and safely terminate an individual session when needed.",
    sessionEmpty: "There are no active sessions.",
    nickname: "Nickname",
    sessionState: "State",
    age: "Age",
    memberCount: "Members",
    endSession: "Terminate",
    terminating: "Terminating…",
    sessionTerminated: "Session terminated.",
    confirmTerminate: "Terminate “{{nickname}}”?",
    invites: "Managed invites",
    invitesLead: "Create expiring, usage-limited invite links without putting the server password in the URL.",
    inviteChannel: "Target channel",
    inviteChannelPlaceholder: "Leave blank for the default channel",
    expiresIn: "Expires in (hours)",
    maxUses: "Maximum uses",
    unlimitedUses: "Use 0 for unlimited uses.",
    createInvite: "Create invite link",
    inviteCreated: "Invite link created",
    inviteSecurity: "Copy and share it now. For security, the full token will not be shown again.",
    copyLink: "Copy link",
    copiedLink: "Invite link copied.",
    defaultChannel: "Default channel",
    revoke: "Revoke",
    inviteRevoked: "Invite link revoked.",
    confirmRevoke: "Revoke this invite link?",
    active: "Active",
    expired: "Expired",
    exhausted: "Exhausted",
    revoked: "Revoked",
    diagnostics: "Diagnostics",
    diagnosticsLead: "Runtime facts for troubleshooting; downloaded reports are sanitized.",
    runtime: "Runtime",
    platform: "Platform",
    databaseSchema: "Database schema",
    createdSessions: "Sessions created",
    downloadReport: "Download diagnostic report",
    exportBackup: "Export database backup",
    logViewer: "Runtime logs",
    logViewerLead: "Recent gateway logs and user connection records; chat content is not recorded.",
    connectionHistory: "User connection records",
    connectionHistoryLead: "Connections, disconnects, and durations grouped by user.",
    connectionActive: "Connected",
    connectionConnecting: "Connecting",
    connectionDisconnected: "Disconnected",
    connectedAt: "Connected",
    connectionAttemptedAt: "Attempted",
    disconnectedAt: "Disconnected",
    duration: "Duration",
    logsUnavailable: "Log file unavailable",
    noLogs: "No logs are available.",
    operationFailed: "The operation failed. Try again later.",
    updateNotice: "Running version {{version}}. Export a backup before upgrading, then replace the application version using the deployment guide.",
    version: "Version",
    audit: "Audit trail",
    auditLead: "Administrator and system actions; chat content and secrets are excluded.",
    auditEmpty: "No audit events.",
  },
} as const;

const germanCopy = {
  ...copy.en,
  loading: "Administrationskonsole wird geladen…",
  adminConsole: "Administrationskonsole",
  changePasswordTitle: "Standardpasswort ändern",
  changePasswordLead: "Das Standardpasswort ist nur für die erste Anmeldung gedacht. Lege ein neues Passwort mit mindestens 12 Zeichen fest.",
  savePassword: "Neues Passwort speichern",
  defaultCredentialNotice: "Standardkonto: admin. Standardpasswort: admin. Das alte Passwort wird nach dem Speichern sofort ungültig.",
  adminUsername: "Administratorname",
  newPassword: "Neues Administratorpasswort",
  passwordPlaceholder: "Mindestens 12 Zeichen",
  passwordHint: "Verwende ein langes, eindeutiges Passwort.",
  confirmPassword: "Administratorpasswort bestätigen",
  languageMenu: "Sprache",
  languageSwitch: "中文",
  welcomeAdmin: "Willkommen zurück",
  loginLead: "Melde dich an, um diese WebSpeak-Instanz zu verwalten.",
  adminPassword: "Administratorpasswort",
  login: "Anmelden",
  backHome: "Zur Startseite",
  overview: "Übersicht",
  server: "Server",
  operations: "Betrieb",
  openGuest: "Gastseite öffnen",
  logout: "Abmelden",
  gatewayRunning: "Gateway läuft",
  serverSettings: "Servereinstellungen",
  serverSettingsLead: "Standard-TeamSpeak-Ziel, Zugriffsregeln und Inhalte der Gastseite verwalten.",
  saving: "Wird gespeichert…",
  saveChanges: "Änderungen speichern",
  teamSpeakTarget: "Standard-TeamSpeak-Ziel",
  serverAddress: "TeamSpeak-Serveradresse",
  serverPlaceholder: "z. B. ts.example.com oder 127.0.0.1",
  serverPort: "Sprachport",
  serverHint: "Serveradresse und Sprachport getrennt eingeben. IPv6-Adressen benötigen keine Klammern.",
  serverPassword: "Serverpasswort",
  optional: "Optional",
  optionalPassword: "Leer lassen, wenn kein Passwort verwendet wird",
  passwordConfigured: "Passwort konfiguriert (leer lassen, um es beizubehalten)",
  change: "Ändern",
  remove: "Entfernen",
  testConnection: "Verbindung testen",
  testing: "Wird getestet…",
  connectionReady: "Verbindung hergestellt",
  connectionFailed: "Verbindung fehlgeschlagen",
  packetLoss: "Paketverlust",
  accessAndIdentity: "Zugriff und Website-Informationen",
  advancedSettings: "Erweiterte Einstellungen",
  advancedSettingsLead: "Erweiterte Gateway-Transportparameter nur bei Bedarf ändern.",
  webrtcSettings: "WebRTC-Audio",
  webrtcEnabled: "WebRTC aktivieren",
  webrtcPortRange: "WebRTC-UDP-Portbereich",
  webrtcPortStart: "Startport",
  webrtcPortEnd: "Endport",
  accessMode: "Gastzugriff",
  fixedMode: "Nur dieser TeamSpeak-Server",
  openMode: "Andere TeamSpeak-Server erlauben",
  siteName: "Anzeigename der Website",
  welcomeText: "Ankündigung",
  welcomeTextZh: "Chinesische Ankündigung",
  welcomeTextEn: "Englische Ankündigung",
  runtimeFacts: "Laufzeitinformationen",
  lastTest: "Letzter Test",
  latency: "Latenz",
  internalPort: "Interner Port",
  unknown: "Unbekannt",
  gotIt: "Verstanden",
  systemStatus: "SYSTEMSTATUS",
  everythingRunning: "WebSpeak läuft",
  overviewLead: "Der Verwaltungsdienst ist verfügbar. Die Erreichbarkeit von TeamSpeak entspricht dem letzten Verbindungstest.",
  running: "Läuft",
  gateway: "Gateway",
  activeSessions: "Aktive Sitzungen",
  targetHealth: "Zielstatus",
  status: "Status",
  recentEvents: "Letzte Ereignisse",
  noRecentEvents: "Keine aktuellen Ereignisse",
  reachable: "Erreichbar",
  unreachable: "Nicht erreichbar",
  notTested: "Nicht getestet",
  invalidPassword: "Das Administratorpasswort ist falsch.",
  rateLimited: "Zu viele Versuche. Bitte später erneut versuchen.",
  requestFailed: "Anfrage fehlgeschlagen. Prüfe die Eingaben und versuche es erneut.",
  refresh: "Aktualisieren",
  sessions: "Aktive Sitzungen",
  sessionEmpty: "Keine aktiven Sitzungen.",
  nickname: "Name",
  sessionState: "Status",
  age: "Dauer",
  memberCount: "Mitglieder",
  endSession: "Trennen",
  terminating: "Wird getrennt…",
  sessionTerminated: "Sitzung getrennt.",
  invites: "Verwaltete Einladungen",
  inviteChannel: "Zielkanal",
  expiresIn: "Gültig für (Stunden)",
  maxUses: "Maximale Nutzungen",
  createInvite: "Einladungslink erstellen",
  inviteCreated: "Einladungslink erstellt",
  copyLink: "Link kopieren",
  copiedLink: "Einladungslink kopiert.",
  revoke: "Widerrufen",
  inviteRevoked: "Einladungslink widerrufen.",
  active: "Aktiv",
  expired: "Abgelaufen",
  exhausted: "Aufgebraucht",
  revoked: "Widerrufen",
  diagnostics: "Diagnose",
  downloadReport: "Diagnosebericht herunterladen",
  exportBackup: "Datenbanksicherung exportieren",
  logViewer: "Laufzeitprotokoll",
  connectionHistory: "Verbindungsaufzeichnungen",
  connectionActive: "Verbunden",
  connectionConnecting: "Verbindung wird hergestellt",
  connectionDisconnected: "Getrennt",
  connectedAt: "Verbunden",
  connectionAttemptedAt: "Versuch",
  disconnectedAt: "Getrennt",
  duration: "Dauer",
  logsUnavailable: "Protokolldatei nicht verfügbar",
  noLogs: "Keine Protokolle verfügbar.",
  operationFailed: "Vorgang fehlgeschlagen. Bitte später erneut versuchen.",
  version: "Version",
  audit: "Prüfprotokoll",
  auditEmpty: "Keine Prüfereignisse.",
} as const;

function tr(key: keyof typeof copy.zh, vars: Record<string, string | number> = {}): string { let value: string = language.value === "zh" ? copy.zh[key] : language.value === "de" ? germanCopy[key] ?? copy.en[key] ?? copy.zh[key] : copy.en[key] ?? copy.zh[key]; for (const [name, replacement] of Object.entries(vars)) value = value.replaceAll(`{{${name}}}`, String(replacement)); return value; }
const passwordStrength = computed(() => Math.min(100, Math.max(8, newPassword.value.length * 5 + (/[\s\W]/.test(newPassword.value) ? 15 : 0))));
const currentPageTitle = computed(() => route.path === "/admin/server" ? tr('server') : route.path === "/admin/operations" ? tr('operations') : tr('overview'));
const testResultText = computed(() => { if (!testResult.value) return ""; const result = testResult.value; const loss = result.packetLossPercent == null ? null : `${tr('packetLoss')} ${result.packetLossPercent}%`; if (!result.ok) return [errorText(result.code ?? result.errorCode), loss].filter(Boolean).join(" · "); return [result.serverName, result.latencyMs == null ? null : `${result.latencyMs} ms`, loss].filter(Boolean).join(" · "); });
const targetStatusText = computed(() => overview.teamSpeak.status === "reachable" ? tr('reachable') : overview.teamSpeak.status === "unreachable" ? tr('unreachable') : tr('notTested'));
const webrtcPortRangeText = computed(() => `${serverForm.webRtcUdpStart}–${serverForm.webRtcUdpEnd}`);

onMounted(loadAdminView);
watch(() => [serverForm.address, serverForm.port, serverForm.serverPassword, serverForm.passwordAction], () => { if (!testing.value && screen.value === "admin") testResult.value = null; });
watch(() => route.path, () => { if (screen.value === "admin" && route.path === "/admin/operations") void loadOperations(); });

async function loadAdminView() { loading.value = true; try { const session = await getJson("/api/admin/session"); if (!session.authenticated) { screen.value = "login"; if (route.path !== "/admin/login") await router.replace("/admin/login"); } else if (session.mustChangePassword) { csrfToken.value = String(session.csrfToken || ""); screen.value = "change-password"; if (route.path !== "/admin/change-password") await router.replace("/admin/change-password"); } else { csrfToken.value = String(session.csrfToken || ""); screen.value = "admin"; if (route.path === "/admin/login" || route.path === "/admin/change-password") await router.replace("/admin"); await Promise.all([loadOverview(), loadServerSettings()]); if (route.path === "/admin/operations") await loadOperations(); } } catch { errorMessage.value = tr('requestFailed'); } finally { loading.value = false; } }
async function login() { submitting.value = true; errorMessage.value = ""; try { const result = await sendJson("/api/admin/login", "POST", { username: loginUsername.value, password: loginPassword.value }, false); csrfToken.value = String(result.csrfToken || ""); loginPassword.value = ""; if (result.mustChangePassword) { screen.value = "change-password"; await router.replace("/admin/change-password"); } else { screen.value = "admin"; await router.replace("/admin"); await Promise.all([loadOverview(), loadServerSettings()]); } } catch (error) { errorMessage.value = errorText((error as ApiError).code); } finally { submitting.value = false; } }
async function changePassword() { errorMessage.value = ""; if (newPassword.value.length < 12) { errorMessage.value = tr('setupPasswordShort'); return; } if (newPassword.value !== confirmNewPassword.value) { errorMessage.value = tr('setupPasswordsMismatch'); return; } submitting.value = true; try { await sendJson("/api/admin/change-password", "POST", { newPassword: newPassword.value }); newPassword.value = ""; confirmNewPassword.value = ""; screen.value = "admin"; await router.replace("/admin"); await Promise.all([loadOverview(), loadServerSettings()]); } catch (error) { errorMessage.value = errorText((error as ApiError).code); } finally { submitting.value = false; } }
async function logout() { try { await sendJson("/api/admin/logout", "POST", {}); } finally { csrfToken.value = ""; screen.value = "login"; await router.replace("/admin/login"); } }
async function loadOverview() { Object.assign(overview, await getJson("/api/admin/overview")); }
async function loadServerSettings() { const value = await getJson("/api/admin/server"); const target = splitTeamSpeakTarget(value.target); Object.assign(serverForm, value, { address: target.address, port: target.port, serverPassword: "", passwordAction: "keep", webRtcEnabled: value.webRtcEnabled === true, webRtcUdpStart: Number(value.webRtcUdpStart || 40000), webRtcUdpEnd: Number(value.webRtcUdpEnd || 40099) }); }
async function loadOperations() { operationsLoading.value = true; try { const [sessions, invites, diagnostics, logs, audit] = await Promise.all([getJson("/api/admin/sessions"), getJson("/api/admin/invites"), getJson("/api/admin/diagnostics"), getJson("/api/admin/logs?limit=100"), getJson("/api/admin/audit?limit=50")]); operations.sessions = Array.isArray(sessions.sessions) ? sessions.sessions : []; operations.invites = Array.isArray(invites.invites) ? invites.invites : []; operations.diagnostics = { version: String(diagnostics.gateway?.version || ""), node: String(diagnostics.gateway?.node || ""), platform: String(diagnostics.gateway?.platform || ""), arch: String(diagnostics.gateway?.arch || ""), schemaVersion: Number(diagnostics.database?.schemaVersion || 0), createdSessions: Number(diagnostics.sessions?.created || 0) }; operations.logs = { available: Boolean(logs.available), entries: Array.isArray(logs.entries) ? logs.entries : [], sessions: Array.isArray(logs.sessions) ? logs.sessions : [] }; operations.audit = Array.isArray(audit.events) ? audit.events : []; } catch (error) { errorMessage.value = errorText((error as ApiError).code); } finally { operationsLoading.value = false; } }
async function terminateSession(session: AdminSession) { if (!window.confirm(tr('confirmTerminate', { nickname: session.nickname }))) return; terminatingSession.value = session.id; errorMessage.value = ""; try { await sendJson(`/api/admin/sessions/${encodeURIComponent(session.id)}/terminate`, "POST", {}); await Promise.all([loadOperations(), loadOverview()]); } catch (error) { errorMessage.value = errorText((error as ApiError).code); } finally { terminatingSession.value = ""; } }
async function createInvite() { submitting.value = true; errorMessage.value = ""; createdInvite.value = null; try { const result = await sendJson("/api/admin/invites", "POST", { channel: inviteForm.channel, expiresInHours: inviteForm.expiresInHours, maxUses: inviteForm.maxUses }); if (typeof result.token !== "string") throw new Error("INVITE_CREATE_FAILED"); createdInvite.value = { token: result.token, link: `${location.origin}/?invite=${encodeURIComponent(result.token)}` }; inviteForm.channel = ""; await loadOperations(); } catch (error) { errorMessage.value = errorText((error as ApiError).code); } finally { submitting.value = false; } }
async function revokeInvite(invite: ManagedInvite) { if (!window.confirm(tr('confirmRevoke'))) return; try { await sendJson(`/api/admin/invites/${encodeURIComponent(invite.id)}/revoke`, "POST", {}); await loadOperations(); } catch (error) { errorMessage.value = errorText((error as ApiError).code); } }
async function copyInviteLink() { if (!createdInvite.value) return; try { await navigator.clipboard.writeText(createdInvite.value.link); showOperationNotice(tr('copiedLink')); } catch { errorMessage.value = tr('operationFailed'); } }
function showOperationNotice(message: string) { errorMessage.value = message; window.setTimeout(() => { if (errorMessage.value === message) errorMessage.value = ""; }, 2200); }
async function downloadBackup() { try { const response = await fetch("/api/admin/backup", { headers: { accept: "application/octet-stream" } }); if (!response.ok) throw new Error("BACKUP_FAILED"); const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `webspeak-backup-${new Date().toISOString().slice(0, 10)}.db`; anchor.click(); URL.revokeObjectURL(url); await loadOperations(); } catch (error) { errorMessage.value = errorText((error as ApiError).code); } }
async function saveServerSettings() { submitting.value = true; errorMessage.value = ""; try { const result = await sendJson("/api/admin/server", "PUT", serverPayload()); const target = splitTeamSpeakTarget(result.settings?.target); Object.assign(serverForm, result.settings, { address: target.address, port: target.port, serverPassword: "", passwordAction: "keep", webRtcEnabled: result.settings.webRtcEnabled === true, webRtcUdpStart: Number(result.settings.webRtcUdpStart || 40000), webRtcUdpEnd: Number(result.settings.webRtcUdpEnd || 40099) }); await loadOverview(); } catch (error) { errorMessage.value = errorText((error as ApiError).code); } finally { submitting.value = false; } }
function handleWebRtcToggle() { if (serverForm.webRtcEnabled) webrtcPortNoticeOpen.value = true; }
async function testServerConnection() { await runTest("/api/admin/server/test", { target: combineTeamSpeakTarget(serverForm.address, serverForm.port), serverPassword: serverForm.passwordAction === "replace" ? serverForm.serverPassword : undefined, passwordAction: serverForm.passwordAction }); if (testResult.value) { await loadOverview(); serverForm.lastTestAt = new Date().toISOString(); serverForm.lastTestLatencyMs = testResult.value.ok ? (testResult.value.latencyMs ?? null) : null; } }
function serverPayload() { return { target: combineTeamSpeakTarget(serverForm.address, serverForm.port), serverPassword: serverForm.passwordAction === "replace" ? serverForm.serverPassword : undefined, passwordAction: serverForm.passwordAction, accessMode: serverForm.accessMode, siteName: serverForm.siteName, welcomeText: serverForm.welcomeText, welcomeTextEn: serverForm.welcomeTextEn, webRtcEnabled: serverForm.webRtcEnabled, webRtcUdpStart: serverForm.webRtcUdpStart, webRtcUdpEnd: serverForm.webRtcUdpEnd }; }
async function runTest(url: string, body: Record<string, unknown>) { testing.value = true; errorMessage.value = ""; testResult.value = null; try { testResult.value = await sendJson(url, "POST", body, url.includes("/server/test")); } catch (error) { testResult.value = { ok: false, code: (error as ApiError).code }; } finally { testing.value = false; } }
async function dismissLegacyNotice() { await sendJson("/api/admin/legacy-import/dismiss", "POST", {}); overview.legacyConfigImported = false; }
function persistLanguage() { localStorage.setItem("webspeak:language", language.value); }
function cycleTheme() { themeMode.value = nextTheme(themeMode.value); saveTheme(themeMode.value); }
function formatDate(value: string | null) { return value ? new Intl.DateTimeFormat(language.value === "zh" ? "zh-CN" : language.value === "de" ? "de-DE" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—"; }
function formatUptime(seconds: number) { const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); return language.value === "zh" ? `已运行 ${hours} 小时 ${minutes} 分钟` : language.value === "de" ? `${hours} Std. ${minutes} Min. aktiv` : `Up ${hours}h ${minutes}m`; }
function formatAge(seconds: number | null) { if (seconds == null) return "—"; if (seconds < 60) return language.value === "zh" ? `${seconds} 秒` : language.value === "de" ? `${seconds} Sek.` : `${seconds}s`; const minutes = Math.floor(seconds / 60); if (minutes < 60) return language.value === "zh" ? `${minutes} 分钟` : language.value === "de" ? `${minutes} Min.` : `${minutes}m`; const hours = Math.floor(minutes / 60); return language.value === "zh" ? `${hours} 小时 ${minutes % 60} 分钟` : language.value === "de" ? `${hours} Std. ${minutes % 60} Min.` : `${hours}h ${minutes % 60}m`; }
function connectionStatusLabel(status: AdminConnectionRecord["status"]) { const names: Record<AdminConnectionRecord["status"], keyof typeof copy.zh> = { active: "connectionActive", connecting: "connectionConnecting", disconnected: "connectionDisconnected", failed: "connectionFailed" }; return tr(names[status]); }
function sessionStateLabel(state: string) { const names: Record<string, { zh: string; en: string; de: string }> = { connecting: { zh: "连接中", en: "Connecting", de: "Verbindung wird hergestellt" }, authenticating: { zh: "认证中", en: "Authenticating", de: "Authentifizierung" }, syncing: { zh: "同步中", en: "Syncing", de: "Synchronisierung" }, connected: { zh: "已连接", en: "Connected", de: "Verbunden" }, interrupted: { zh: "已中断", en: "Interrupted", de: "Unterbrochen" }, reconnecting: { zh: "重连中", en: "Reconnecting", de: "Wiederverbindung" }, disconnecting: { zh: "断开中", en: "Disconnecting", de: "Wird getrennt" }, failed: { zh: "失败", en: "Failed", de: "Fehlgeschlagen" }, idle: { zh: "空闲", en: "Idle", de: "Inaktiv" } }; return names[state]?.[language.value] ?? state; }
function inviteStatusLabel(status: ManagedInvite["status"]) { const names: Record<ManagedInvite["status"], keyof typeof copy.zh> = { active: "active", expired: "expired", exhausted: "exhausted", revoked: "revoked" }; return tr(names[status]); }
function formatContext(context: Record<string, string | number | boolean>) { return Object.entries(context).map(([key, value]) => `${key}=${value}`).join(" · "); }
function eventName(event: string) { if (event === "ADMIN_LOGIN_FAILED") return language.value === "zh" ? "管理员登录失败" : "Administrator login failed"; if (event === "CONNECTION_TEST_SUCCEEDED") return language.value === "zh" ? "连接测试成功" : "Connection test succeeded"; if (event === "CONNECTION_TEST_FAILED") return language.value === "zh" ? "连接测试失败" : "Connection test failed"; const names: Record<string, keyof typeof copy.zh> = { ADMIN_LOGIN_SUCCEEDED: "loginEvent", ADMIN_LOGOUT: "logoutEvent", SETTINGS_CHANGED: "settingsEvent", ADMIN_INITIALIZED: "initializedEvent", LEGACY_CONFIG_IMPORTED: "importedEvent", CONNECTION_TEST: "testEvent" }; return names[event] ? tr(names[event]) : language.value === "zh" ? "系统事件" : event.replaceAll("_", " "); }
  function errorText(code?: string) { if (code === "INVALID_PASSWORD") return tr('invalidPassword'); if (code === "INVALID_ADMIN_PASSWORD") return tr('setupPasswordShort'); if (code === "PASSWORD_CHANGE_REQUIRED") return tr('changePasswordLead'); if (code === "RATE_LIMITED") return tr('rateLimited'); if (code === "INVALID_WEBRTC_PORT_RANGE") return language.value === "zh" ? "WebRTC UDP 端口范围无效，请填写 1024–65535 且起始端口不能大于结束端口。" : language.value === "de" ? "Der WebRTC-UDP-Portbereich ist ungültig. Verwende 1024–65535; der Startport darf nicht größer als der Endport sein." : "The WebRTC UDP port range is invalid. Use 1024–65535 with the start no greater than the end."; if (code === "WEBRTC_PORT_LOCKED") return language.value === "zh" ? "WebRTC 已开启，请先关闭并保存后再修改端口范围。" : language.value === "de" ? "WebRTC ist aktiviert. Deaktiviere es und speichere zuerst, bevor du den Portbereich änderst." : "WebRTC is enabled. Turn it off and save before changing the port range."; const probe: Record<string, { zh: string; en: string; de: string }> = { INVALID_TARGET: { zh: "TeamSpeak 服务器地址格式无效。", en: "The TeamSpeak server address is invalid.", de: "Die TeamSpeak-Serveradresse ist ungültig." }, HOST_NOT_FOUND: { zh: "找不到服务器主机名。", en: "The server hostname could not be resolved.", de: "Der Servername konnte nicht aufgelöst werden." }, UNREACHABLE: { zh: "无法连接 TeamSpeak 服务器。", en: "The TeamSpeak server is unreachable.", de: "Der TeamSpeak-Server ist nicht erreichbar." }, TIMEOUT: { zh: "连接 TeamSpeak 超时。", en: "The TeamSpeak connection timed out.", de: "Die Verbindung zu TeamSpeak ist abgelaufen." }, PROTOCOL_NEGOTIATION_FAILED: { zh: "无法识别 TeamSpeak 协议。", en: "TeamSpeak protocol negotiation failed.", de: "Die Aushandlung des TeamSpeak-Protokolls ist fehlgeschlagen." }, SERVER_REJECTED: { zh: "TeamSpeak 服务器拒绝了连接。", en: "The TeamSpeak server rejected the connection.", de: "Der TeamSpeak-Server hat die Verbindung abgelehnt." }, TARGET_NOT_ALLOWED: { zh: "此地址不允许在开放模式中使用。", en: "This target is not allowed in open mode.", de: "Dieses Ziel ist im offenen Modus nicht erlaubt." } }; return probe[code || ""]?.[language.value] ?? tr('requestFailed'); }

interface ApiError extends Error { code?: string }
async function getJson(url: string): Promise<any> { const response = await fetch(url, { headers: { accept: "application/json" } }); return parseResponse(response); }
async function sendJson(url: string, method: string, body: unknown, authenticated = true): Promise<any> { const response = await fetch(url, { method, headers: { "content-type": "application/json", accept: "application/json", ...(authenticated && csrfToken.value ? { "x-csrf-token": csrfToken.value } : {}) }, body: JSON.stringify(body) }); return parseResponse(response); }
async function parseResponse(response: Response) { const value = await response.json().catch(() => ({})); if (!response.ok) { const error = new Error(String(value.code || response.statusText)) as ApiError; error.code = String(value.code || "REQUEST_FAILED"); if (response.status === 401 && screen.value === "admin") { screen.value = "login"; void router.replace("/admin/login"); } throw error; } return value; }
</script>

<style scoped>
.intro-copy h1{font-size:clamp(38px,4.2vw,56px)!important;line-height:1.05!important;letter-spacing:-.055em!important}
.admin-topbar .theme-toggle{display:inline-flex;align-items:center;gap:6px}
:global(*){box-sizing:border-box}:global(body){margin:0;font-family:Inter,"Segoe UI","PingFang SC",sans-serif;color:#20302c;background:#f4f8f6}.admin-root{min-height:100dvh}.auth-layout{display:grid;min-height:100dvh;grid-template-columns:minmax(360px,.82fr) minmax(520px,1.18fr)}.auth-intro{display:flex;flex-direction:column;padding:48px clamp(38px,6vw,92px);color:#e8fffa;background:radial-gradient(circle at 20% 0,rgba(90,211,191,.28),transparent 32rem),#063f3b}.admin-brand{display:flex;align-items:center;gap:12px}.admin-brand>span{display:grid;place-items:center;width:42px;height:42px;color:#fff;background:#07877d;border-radius:12px;box-shadow:0 8px 22px rgba(0,0,0,.15)}.admin-brand strong,.admin-brand small{display:block}.admin-brand strong{font-size:20px;letter-spacing:-.04em}.admin-brand small{margin-top:3px;color:#9bc9c2;font-size:11px}.intro-copy{margin:auto 0 48px}.intro-copy i{color:#75e3d2;font-size:12px;font-style:normal;font-weight:800;letter-spacing:.12em}.intro-copy h1{max-width:540px;margin:16px 0;font-size:clamp(40px,5vw,66px);line-height:1.03;letter-spacing:-.065em}.intro-copy p{max-width:530px;color:#a9d0ca;font-size:16px;line-height:1.75}.step-list{display:grid;gap:10px}.step-list button{display:flex;align-items:center;gap:13px;width:100%;padding:13px;color:#89bbb4;text-align:left;background:transparent;border:1px solid transparent;border-radius:12px}.step-list button.active{color:#fff;background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.1)}.step-list button.done{color:#8ee4d7}.step-list button>span{display:grid;place-items:center;width:28px;height:28px;flex:none;border:1px solid currentColor;border-radius:50%;font-size:12px;font-weight:800}.step-list strong,.step-list small{display:block}.step-list strong{font-size:13px}.step-list small{margin-top:3px;font-size:10px;opacity:.75}.auth-panel{position:relative;display:grid;place-items:center;padding:80px 40px;background:radial-gradient(circle at 80% 10%,rgba(99,205,188,.15),transparent 25rem),#f5f9f7}.panel-tools{position:absolute;top:28px;right:34px}.panel-tools button,.language-link,.admin-topbar button{color:#08766e;background:#e4f3ef;border:1px solid #cae7e0;border-radius:8px;padding:8px 12px;font-size:11px;font-weight:700;cursor:pointer}.setup-card,.login-card{width:min(560px,100%);padding:36px;background:#fff;border:1px solid #dfeae6;border-radius:20px;box-shadow:0 20px 55px rgba(27,69,61,.09)}.setup-card header small{color:#07877d;font-size:11px;font-weight:800;letter-spacing:.08em}.setup-card header h2,.login-card h1{margin:10px 0 7px;font-size:29px;letter-spacing:-.045em}.setup-card header p,.login-card header p{margin:0;color:#71817c;font-size:13px;line-height:1.6}.form-stack,.login-card form{display:grid;gap:17px;margin-top:27px}label>span,fieldset legend{display:block;margin-bottom:7px;color:#40514c;font-size:12px;font-weight:700}label em{color:#91a09c;font-size:10px;font-style:normal;font-weight:500}label small{display:block;margin-top:6px;color:#899792;font-size:10px;line-height:1.5}input,textarea{width:100%;padding:11px 12px;color:#22332f;background:#fbfdfc;border:1px solid #dbe7e3;border-radius:9px;font:inherit;font-size:13px;outline:none}input{height:43px}input:focus,textarea:focus{border-color:#54bdb2;box-shadow:0 0 0 3px rgba(84,189,178,.13)}textarea{resize:vertical}.strength{height:4px;overflow:hidden;background:#e7eeeb;border-radius:4px}.strength i{display:block;height:100%;background:linear-gradient(90deg,#e7a452,#50c5a2);transition:.2s}fieldset{display:grid;gap:9px;margin:0;padding:0;border:0}.choice{display:flex;align-items:flex-start;gap:10px;padding:13px;border:1px solid #dfe9e6;border-radius:10px;cursor:pointer}.choice:has(input:checked){border-color:#62bfb5;background:#eff8f6}.choice input{width:16px;height:16px;flex:none;margin:2px 0}.choice strong,.choice small{display:block}.choice strong{font-size:12px}.choice small{margin-top:4px;color:#7b8985;font-size:10px;line-height:1.45}.setup-card footer{display:flex;align-items:center;justify-content:space-between;margin-top:28px;padding-top:20px;border-top:1px solid #edf1ef}.primary-button,.secondary-button,.text-button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:42px;padding:0 18px;border:0;border-radius:9px;font-size:12px;font-weight:800;cursor:pointer}.primary-button{color:#fff;background:#087d74}.primary-button:hover{background:#056b63}.primary-button:disabled,.secondary-button:disabled{opacity:.55;cursor:not-allowed}.secondary-button{color:#08776e;background:#eaf6f3;border:1px solid #cfe9e3}.text-button{color:#687a74;background:transparent}.wide{width:100%}.spinner{display:inline-block;width:22px;height:22px;border:2px solid #cde6df;border-top-color:#087d74;border-radius:50%;animation:spin .7s linear infinite}.spinner.small{width:15px;height:15px;border-color:rgba(255,255,255,.35);border-top-color:currentColor}@keyframes spin{to{transform:rotate(360deg)}}.alert{padding:12px 14px;border-radius:9px;font-size:12px;line-height:1.5}.alert.error{color:#a3423d;background:#fff0ef;border:1px solid #f4cbc8}.alert.info{color:#23665f;background:#eaf7f3;border:1px solid #cde9e2}.test-result{display:flex;gap:10px;padding:12px;border-radius:9px}.test-result.success{color:#246c52;background:#eaf8f0}.test-result.error{color:#a3423d;background:#fff0ef}.test-result strong,.test-result small{display:block}.test-result strong{font-size:12px}.test-result small{margin-top:3px;font-size:10px}.login-page{display:grid;min-height:100dvh;place-items:center;padding:25px;background:radial-gradient(circle at 50% 10%,rgba(95,211,191,.2),transparent 30rem),#f4f8f6}.login-card{max-width:430px;text-align:center}.admin-brand.centered{justify-content:center}.login-card header{margin:30px 0 24px}.login-card label{text-align:left}.language-link{margin-top:20px}.center-card{position:absolute;inset:0;display:grid;place-content:center;justify-items:center;color:#60746e}.admin-shell{display:grid;min-height:100dvh;grid-template-columns:236px minmax(0,1fr)}.admin-sidebar{position:sticky;top:0;display:flex;height:100dvh;flex-direction:column;padding:26px 18px;background:#073f3b;color:#eafffb}.admin-sidebar .admin-brand{padding:0 8px 28px}.admin-sidebar nav{display:grid;gap:6px}.admin-sidebar nav a,.sidebar-bottom a,.sidebar-bottom button{display:flex;align-items:center;gap:10px;padding:11px 12px;color:#9fc8c2;text-decoration:none;background:transparent;border:0;border-radius:9px;font-size:12px;font-weight:700;cursor:pointer}.admin-sidebar nav a.active{color:#fff;background:#0b5b54}.sidebar-bottom{display:grid;gap:4px;margin-top:auto;padding-top:20px;border-top:1px solid rgba(255,255,255,.1)}.admin-main{min-width:0}.admin-topbar{display:flex;align-items:center;justify-content:space-between;min-height:82px;padding:0 clamp(24px,4vw,58px);background:#fff;border-bottom:1px solid #e4ebe8}.admin-topbar small,.admin-topbar h1{display:block;margin:0}.admin-topbar small{color:#8b9995;font-size:10px;text-transform:uppercase}.admin-topbar h1{margin-top:4px;font-size:21px}.admin-topbar>div:last-child{display:flex;align-items:center;gap:8px;color:#66807a;font-size:11px}.running-dot{width:7px;height:7px;background:#55d17a;border-radius:50%;box-shadow:0 0 0 4px #e5f8ea}.page-content{width:min(1180px,calc(100% - 48px));margin:0 auto;padding:40px 0 70px}.page-alert{margin:20px 24px 0}.page-heading{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:24px}.page-heading h2{margin:0;font-size:25px}.page-heading p{margin:7px 0 0;color:#75857f;font-size:12px}.settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.settings-card,.readonly-card,.overview-card{padding:24px;background:#fff;border:1px solid #dfe8e5;border-radius:14px}.settings-card{display:grid;align-content:start;gap:18px}.settings-card h3,.readonly-card h3,.overview-card h3{margin:0;font-size:15px}.password-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:9px}.password-actions{display:flex;gap:5px;padding-bottom:1px}.password-actions button{height:42px;padding:0 10px;color:#55706a;background:#eef4f2;border:0;border-radius:8px;font-size:10px;font-weight:700;cursor:pointer}.password-actions button.active{color:#fff;background:#16877d}.password-actions button.danger{color:#a24640;background:#fff0ef}.readonly-card{margin-top:20px}.readonly-card dl,.overview-card dl{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:18px 0 0}.readonly-card dl div,.overview-card dl div{padding:13px;background:#f6f9f8;border-radius:9px}.readonly-card dt,.overview-card dt{color:#85948f;font-size:10px}.readonly-card dd,.overview-card dd{margin:5px 0 0;font-size:12px;font-weight:700}.import-notice{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}.import-notice button{color:#08776e;background:transparent;border:0;font-weight:800;cursor:pointer}.hero-status{display:flex;align-items:center;justify-content:space-between;padding:30px;color:#eafffa;background:linear-gradient(135deg,#07524c,#087d74);border-radius:16px}.hero-status small{color:#80d8cc;font-size:10px;font-weight:800;letter-spacing:.1em}.hero-status h2{margin:9px 0 5px;font-size:27px}.hero-status p{margin:0;color:#a8d8d1;font-size:12px}.status-badge{display:flex;align-items:center;gap:7px;padding:8px 12px;background:rgba(255,255,255,.12);border-radius:99px;font-size:11px;font-weight:700}.status-badge i{width:7px;height:7px;background:#69e78b;border-radius:50%}.metric-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:18px 0}.metric-grid article{position:relative;padding:21px;background:#fff;border:1px solid #dfe8e5;border-radius:13px}.metric-grid article>span{position:absolute;top:17px;right:17px;display:grid;place-items:center;width:35px;height:35px;color:#087d74;background:#e9f5f2;border-radius:9px}.metric-grid small,.metric-grid strong,.metric-grid em{display:block}.metric-grid small{color:#82908c;font-size:10px}.metric-grid strong{max-width:80%;margin-top:13px;overflow:hidden;font-size:20px;text-overflow:ellipsis;white-space:nowrap}.metric-grid em{margin-top:7px;color:#71817c;font-size:10px;font-style:normal}.overview-columns{display:grid;grid-template-columns:1.05fr .95fr;gap:18px}.overview-card header{display:flex;justify-content:space-between}.overview-card header p{margin:5px 0 0;color:#7e8c88;font-size:10px}.overview-card header a{color:#087d74;font-size:11px;font-weight:700;text-decoration:none}.overview-card dl{grid-template-columns:1fr 1fr}.overview-card dd{display:flex;align-items:center;gap:7px}.overview-card dd i{width:7px;height:7px;background:#aab5b2;border-radius:50%}.overview-card dd i.reachable{background:#55cb76}.overview-card dd i.unreachable{background:#d85f57}.event-list{display:grid;gap:10px;margin:18px 0 0;padding:0;list-style:none}.event-list li{display:flex;align-items:center;gap:10px;padding:10px;background:#f6f9f8;border-radius:9px}.event-list li>span{display:grid;place-items:center;width:27px;height:27px;color:#087d74;background:#dff1ed;border-radius:8px}.event-list strong,.event-list small{display:block}.event-list strong{font-size:11px}.event-list small{margin-top:3px;color:#879590;font-size:9px}.event-list .empty-event{display:block;color:#82908c;text-align:center}
@media(max-width:850px){.auth-layout{display:block}.auth-intro{min-height:auto;padding:28px 24px}.intro-copy{margin:55px 0 35px}.step-list{display:none}.auth-panel{padding:35px 18px 60px}.panel-tools{top:18px;right:18px}.admin-shell{display:block}.admin-sidebar{position:static;width:100%;height:auto;flex-direction:row;align-items:center;padding:12px 16px}.admin-sidebar .admin-brand{padding:0}.admin-sidebar .admin-brand small{display:none}.admin-sidebar nav{display:flex;margin-left:auto}.admin-sidebar nav a{font-size:0}.admin-sidebar nav a .ui-icon{width:20px;height:20px}.sidebar-bottom{display:flex;margin:0 0 0 8px;padding:0;border:0}.sidebar-bottom a{display:none}.sidebar-bottom button{font-size:0}.settings-grid,.overview-columns{grid-template-columns:1fr}.readonly-card dl{grid-template-columns:1fr 1fr}.admin-topbar{padding:0 18px}.page-content{width:min(100% - 28px,700px);padding-top:24px}.metric-grid{grid-template-columns:1fr}.hero-status{align-items:flex-start;gap:20px}.hero-status p{max-width:75%}}
@media(max-width:520px){.setup-card,.login-card{padding:25px 20px;border-radius:15px}.setup-card header h2{font-size:24px}.admin-topbar>div:last-child{font-size:0}.page-heading{gap:15px}.page-heading .primary-button{padding-inline:12px}.settings-card,.readonly-card,.overview-card{padding:18px}.readonly-card dl,.overview-card dl{grid-template-columns:1fr}.password-row{grid-template-columns:1fr}.password-actions{padding:0}.hero-status{padding:23px}.status-badge{display:none}}
 .security-note{margin:18px 0 0;color:#879590;font-size:11px;line-height:1.5}
:global(html[data-theme="dark"] .admin-root), :global(html[data-theme="dark"] .login-page), :global(html[data-theme="dark"] .auth-panel) { color: #e8f3f0; background: #101918; }
:global(html[data-theme="dark"] .admin-topbar), :global(html[data-theme="dark"] .setup-card), :global(html[data-theme="dark"] .login-card), :global(html[data-theme="dark"] .settings-card), :global(html[data-theme="dark"] .readonly-card), :global(html[data-theme="dark"] .overview-card), :global(html[data-theme="dark"] input), :global(html[data-theme="dark"] textarea) { color: #e8f3f0; background: #172321; border-color: #30413d; }
:global(html[data-theme="dark"] .admin-topbar), :global(html[data-theme="dark"] .settings-card), :global(html[data-theme="dark"] .readonly-card), :global(html[data-theme="dark"] .overview-card) { border-color: #30413d; }
:global(html[data-theme="dark"] .admin-topbar h1), :global(html[data-theme="dark"] .page-heading h2), :global(html[data-theme="dark"] .settings-card h3), :global(html[data-theme="dark"] .readonly-card h3), :global(html[data-theme="dark"] .overview-card h3), :global(html[data-theme="dark"] .login-card h1) { color: #e8f3f0; }
:global(html[data-theme="dark"] .page-heading p), :global(html[data-theme="dark"] .admin-topbar small), :global(html[data-theme="dark"] label > span) { color: #9bb0aa; }
:global(html[data-theme="dark"] .metric-grid article), :global(html[data-theme="dark"] .readonly-card dl div), :global(html[data-theme="dark"] .overview-card dl div), :global(html[data-theme="dark"] .event-list li) { background: #202f2c; border-color: #30413d; }
:global(html[data-theme="dark"] .admin-topbar button), :global(html[data-theme="dark"] .admin-topbar .language-select), :global(html[data-theme="dark"] .language-link), :global(html[data-theme="dark"] .home-link) { color: #a9d9d1; background: #203531; border-color: #38564f; }
@media (prefers-color-scheme: dark) { :global(html[data-theme="system"] .admin-root), :global(html[data-theme="system"] .login-page), :global(html[data-theme="system"] .auth-panel) { color: #e8f3f0; background: #101918; } :global(html[data-theme="system"] .admin-topbar), :global(html[data-theme="system"] .setup-card), :global(html[data-theme="system"] .login-card), :global(html[data-theme="system"] .settings-card), :global(html[data-theme="system"] .readonly-card), :global(html[data-theme="system"] .overview-card) { background: #172321; border-color: #30413d; } }
.operations-grid{display:grid;grid-template-columns:minmax(0,1.12fr) minmax(340px,.88fr);gap:18px}.system-notice{display:flex;align-items:center;gap:8px;margin-bottom:18px}.operation-card{min-width:0;padding:22px;background:#fff;border:1px solid #dfe8e5;border-radius:14px}.operation-card header{display:flex;align-items:flex-start;justify-content:space-between;gap:15px}.operation-card h3{margin:0;font-size:15px}.operation-card header p{margin:5px 0 0;color:#7e8c88;font-size:10px;line-height:1.5}.operation-card header>strong{color:#087d74;font-size:22px}.table-wrap{margin:18px -22px -22px;overflow:auto;border-top:1px solid #edf1ef}.table-wrap table{width:100%;min-width:600px;border-collapse:collapse;text-align:left}.table-wrap th,.table-wrap td{padding:12px 14px;border-bottom:1px solid #edf1ef;font-size:11px;white-space:nowrap}.table-wrap th{color:#83928d;font-size:10px;font-weight:700}.table-wrap td strong,.table-wrap td small{display:block}.table-wrap td small{margin-top:3px;color:#8a9994;font-size:9px}.state-pill{display:inline-flex;padding:4px 7px;color:#236c63;background:#e5f5f1;border-radius:99px;font-size:10px;font-weight:700}.state-pill.expired,.state-pill.exhausted,.state-pill.revoked{color:#8b6259;background:#f8ece9}.danger-button,.text-danger{color:#a34f48;background:#fff0ee;border:1px solid #f1d2cd;border-radius:7px;font-size:10px;font-weight:700;cursor:pointer}.danger-button{padding:7px 9px}.text-danger{padding:4px 7px;border:0}.danger-button:disabled{opacity:.55;cursor:wait}.operation-empty{display:grid;place-items:center;gap:8px;min-height:130px;color:#8b9994;text-align:center;font-size:11px}.operation-empty .ui-icon{color:#72afa7}.invite-form{display:grid;gap:14px;margin-top:18px}.invite-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.field-help{margin-top:-8px;color:#899792;font-size:10px}.generated-invite{display:grid;gap:8px;margin-top:17px;padding:12px;color:#29685f;background:#eaf7f3;border-radius:9px}.generated-invite strong{font-size:11px}.generated-invite small{color:#648780;font-size:9px;line-height:1.45}.generated-link{display:flex;gap:6px}.generated-link input{height:36px;min-width:0;padding:8px;font-size:10px}.generated-link .secondary-button{min-height:36px;padding-inline:9px;white-space:nowrap;font-size:10px}.invite-list{display:grid;gap:9px;margin-top:18px;padding-top:15px;border-top:1px solid #edf1ef}.invite-row{display:flex;align-items:center;justify-content:space-between;gap:9px;padding:10px;background:#f6f9f8;border-radius:9px}.invite-row>div:first-child{min-width:0}.invite-row strong,.invite-row small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.invite-row strong{font-size:11px}.invite-row small{max-width:260px;margin-top:4px;color:#86958f;font-size:9px}.invite-row-meta{display:flex;align-items:center;gap:7px;flex:none;color:#70827b;font-size:9px}.lower-operations{margin-top:18px}.text-link{color:#087d74;font-size:10px;font-weight:700;text-decoration:none;white-space:nowrap}.diagnostic-list{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:18px 0}.diagnostic-list div{padding:10px;background:#f6f9f8;border-radius:8px}.diagnostic-list dt{color:#8a9893;font-size:9px}.diagnostic-list dd{margin:4px 0 0;overflow:hidden;font-size:11px;font-weight:700;text-overflow:ellipsis;white-space:nowrap}.logs-card{display:flex;min-height:250px;flex-direction:column}.audit-card{min-height:250px}.muted-label{color:#9aa6a2;font-size:9px}.log-list{display:grid;gap:7px;max-height:280px;margin-top:16px;overflow:auto}.log-row{display:flex;align-items:flex-start;gap:8px;padding:8px;background:#f6f9f8;border-radius:7px}.log-row>div{min-width:0}.log-row strong,.log-row small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.log-row strong{font-size:10px}.log-row small{margin-top:4px;color:#899792;font-size:8px}.log-level{flex:none;padding:3px 5px;border-radius:4px;color:#356c62;background:#e3f3ef;font-size:8px;font-weight:800}.log-level.warn{color:#8b6a3e;background:#fbf1dc}.log-level.error,.log-level.fatal{color:#a34f48;background:#fff0ee}
:global(html[data-theme="dark"] .connection-row),:global(html[data-theme="dark"] .connection-history-heading){color:#e8f3f0;background:#202f2c;border-color:#30413d}
:global(html[data-theme="dark"] .operation-card),:global(html[data-theme="dark"] .invite-row),:global(html[data-theme="dark"] .diagnostic-list div),:global(html[data-theme="dark"] .log-row){color:#e8f3f0;background:#202f2c;border-color:#30413d}:global(html[data-theme="dark"] .table-wrap){border-color:#30413d}:global(html[data-theme="dark"] .table-wrap th),:global(html[data-theme="dark"] .table-wrap td),:global(html[data-theme="dark"] .invite-list){border-color:#30413d}:global(html[data-theme="dark"] .operation-card header p),:global(html[data-theme="dark"] .table-wrap th),:global(html[data-theme="dark"] .table-wrap td small),:global(html[data-theme="dark"] .invite-row small){color:#9bb0aa}
@media(max-width:850px){.operations-grid{grid-template-columns:1fr}.operation-wide{overflow:hidden}}
@media(max-width:520px){.operation-card{padding:18px}.table-wrap{margin-left:-18px;margin-right:-18px;margin-bottom:-18px}.invite-form-grid,.diagnostic-list{grid-template-columns:1fr}.generated-link{display:grid}.invite-row{align-items:flex-start;flex-direction:column}.invite-row-meta{width:100%;justify-content:flex-end}.lower-operations{margin-top:14px}}
.target-fields{display:grid;grid-template-columns:minmax(0,1fr) 132px;gap:12px}
.webrtc-card .card-help{margin:5px 0 0;color:#7e8c88;font-size:10px;line-height:1.5}.toggle-choice{margin:0}.webrtc-card>.field-help{margin-top:-8px}
@media(max-width:520px){.target-fields{grid-template-columns:1fr}}

/* Keep administration inside the browser viewport. Long data sets scroll in
   their own cards instead of pushing the whole page below the fold. */
.admin-shell{height:100dvh;min-height:100dvh;overflow:hidden}
.admin-main{min-height:0;display:flex;flex-direction:column;overflow:hidden}
.admin-topbar{flex:0 0 auto}
.page-content{flex:1 1 auto;min-height:0;overflow-y:auto}
.operations-page{display:flex;flex-direction:column;width:min(1400px,calc(100% - 48px));height:calc(100dvh - 82px);overflow:hidden;padding-top:28px;padding-bottom:18px}
.operations-page .page-heading{flex:0 0 auto;margin-bottom:16px}
.operations-page .system-notice{flex:0 0 auto;margin-bottom:12px}
.operations-page .operations-grid{min-width:0;min-height:0}
.operations-primary{flex:0 0 auto;grid-template-columns:minmax(0,1.2fr) minmax(360px,.8fr)}
.operations-primary>.operation-card{min-height:0;overflow:hidden}
.operations-primary .table-wrap{max-height:190px}
.operations-primary .invite-list{max-height:132px;overflow-y:auto}
.lower-operations{flex:1 1 0;grid-template-columns:minmax(210px,.9fr) minmax(0,1.1fr) minmax(210px,.9fr);margin-top:14px}
.lower-operations>.operation-card{min-height:0}
.diagnostics-card,.logs-card,.audit-card{overflow:hidden}
.diagnostics-card{display:flex;flex-direction:column;overflow-y:auto}
.diagnostics-card .secondary-button{margin-top:auto}
.logs-card,.audit-card{display:flex;flex-direction:column}
.logs-card .log-list,.audit-card .event-list{flex:1 1 0;min-height:0;max-height:none;overflow-y:auto}

@media(max-width:850px){
  .admin-main{height:100%}
  .operations-page{width:min(100% - 28px,700px);height:auto;min-height:calc(100dvh - 82px);overflow:visible}
  .operations-page .lower-operations{flex:none}
}

/* Keep every admin surface inside the viewport. The page content and data
   lists are the scroll containers, never the document body. */
:global(html),:global(body),:global(#app){width:100%;height:100dvh;min-height:0;max-height:100dvh;overflow:hidden}
.admin-root{height:100dvh;min-height:0;overflow:hidden}
.login-page{height:100dvh;min-height:0;overflow:hidden}
.login-card{max-height:calc(100dvh - 50px);overflow-y:auto}

@media(max-width:850px){
  .admin-shell{display:flex;flex-direction:column}
  .admin-main{height:auto;flex:1 1 auto}
}

/* Keep static admin cards at their own height. Only long data collections
   become scroll surfaces, so a busy event feed cannot stretch its neighbour
   or turn the whole admin view into a second page. */
.admin-main>.page-alert{flex:0 0 auto}
.page-content{display:flex;flex:1 1 auto;min-height:0;flex-direction:column;overflow:hidden}
.overview-page{padding:28px 0 18px}
.overview-page .import-notice{flex:0 0 auto;margin-top:0;margin-bottom:12px}
.overview-page .hero-status{flex:0 0 auto;padding:24px}
.overview-page .metric-grid{flex:0 0 auto;gap:12px;margin:14px 0}
.overview-page .metric-grid article{padding:18px}
.overview-page .overview-columns{flex:1 1 0;min-height:0;align-items:stretch;gap:14px}
.target-health-card{align-self:start}
.recent-events-card{display:flex;height:100%;min-height:0;flex-direction:column;overflow:hidden}
.recent-events-card .event-list{flex:1 1 auto;min-height:0;max-height:none;overflow-y:auto}
.server-page{padding:28px 0 18px}
.server-page .page-heading{flex:0 0 auto;margin-bottom:14px}
.server-page .settings-grid{flex:1 1 auto;min-height:0;align-items:stretch;gap:14px}
.server-page .settings-card{min-height:0;overflow-y:auto;padding:20px}
.server-page .readonly-card{flex:0 0 auto;margin-top:14px;padding:16px 20px}
.server-page .readonly-card dl{gap:10px;margin-top:12px}
.operations-page{height:auto;min-height:0}
.operations-primary{flex:0 0 250px}
.operations-primary>.operation-card{overflow-y:auto}
.operations-primary>.operation-card{padding:14px 16px}
.operations-primary .operation-card header p{line-height:1.3}
.operations-primary .invite-form{gap:6px;margin-top:8px}
.operations-primary label>span{margin-bottom:4px}
.operations-primary input{height:34px;padding:7px 10px}
.operations-primary .field-help{margin-top:-4px}
.operations-primary .primary-button{min-height:34px}

/* Theme all native scrollbars used by the admin surfaces. */
:global(*){scrollbar-color:#8fcfc7 transparent;scrollbar-width:thin}
:global(*::-webkit-scrollbar){width:8px;height:8px}
:global(*::-webkit-scrollbar-track){background:transparent}
:global(*::-webkit-scrollbar-thumb){background:#a7d9d2;background-clip:padding-box;border:2px solid transparent;border-radius:999px}
:global(*::-webkit-scrollbar-thumb:hover){background:#6bbab1;background-clip:padding-box;border-width:1px}
:global(:root[data-theme="dark"] *){scrollbar-color:#438f88 transparent}
:global(:root[data-theme="dark"] *::-webkit-scrollbar-thumb){background:#438f88;border-color:transparent}
:global(:root[data-theme="dark"] *::-webkit-scrollbar-thumb:hover){background:#69c7bc}

@media(max-width:850px){
  .page-content{width:min(100% - 28px,700px);padding-top:20px;padding-bottom:14px}
  .overview-page .hero-status{padding:18px}
  .overview-page .hero-status h2{font-size:24px}
  .overview-page .metric-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:10px 0}
  .overview-page .metric-grid article{padding:12px}
  .overview-page .metric-grid article>span{top:10px;right:10px;width:28px;height:28px}
  .overview-page .metric-grid strong{margin-top:9px;font-size:15px}
  .overview-page .overview-columns{grid-template-rows:minmax(0,1fr) minmax(0,1fr);overflow:hidden}
  .overview-page .target-health-card{align-self:stretch;min-height:0;overflow-y:auto}
  .overview-page .recent-events-card{height:100%}
  .server-page .settings-grid{grid-template-columns:1fr;grid-auto-rows:minmax(190px,1fr);overflow-y:auto}
  .server-page .readonly-card dl{grid-template-columns:repeat(2,minmax(0,1fr))}
  .operations-page{height:100%;overflow:hidden}
  .operations-page .operations-primary,.operations-page .lower-operations{grid-template-columns:1fr;min-height:0;overflow-y:auto;align-content:start}
  .operations-page .operations-primary{grid-auto-rows:240px}
  .operations-page .lower-operations{grid-auto-rows:190px}
  .operations-page .lower-operations{flex:1 1 0}
}
.advanced-card{grid-column:1 / -1}
.advanced-card .card-help{margin:5px 0 0;color:#7e8c88;font-size:10px;line-height:1.5}
.advanced-card .toggle-choice{margin:0}
.webrtc-port-fields{display:grid;gap:10px;padding:14px;background:#f6f9f8;border:1px solid #e4efeb;border-radius:10px}
.port-fields-heading strong,.port-fields-heading small{display:block}
.port-fields-heading strong{font-size:11px}
.port-fields-heading small{margin-top:4px;color:#899792;font-size:10px;line-height:1.45}
.port-inputs{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.port-inputs label>span{font-size:10px}
.port-inputs input:disabled{color:#70817b;background:#e9f1ee;border-color:#d7e5e1;cursor:not-allowed;opacity:1}
.modal-backdrop{position:fixed;z-index:20;inset:0;display:grid;place-items:center;padding:22px;background:rgba(5,41,38,.38);backdrop-filter:blur(3px)}
.modal-card{width:min(410px,100%);padding:26px;background:#fff;border:1px solid #d9e9e4;border-radius:16px;box-shadow:0 20px 60px rgba(14,62,55,.2)}
.modal-icon{display:grid;place-items:center;width:38px;height:38px;color:#087d74;background:#e3f5f0;border-radius:11px}
.modal-card h2{margin:16px 0 8px;font-size:20px}
.modal-card p{margin:0 0 20px;color:#71817c;font-size:12px;line-height:1.7}
:global(html[data-theme="dark"] .webrtc-port-fields){background:#202f2c;border-color:#30413d}
:global(html[data-theme="dark"] .port-fields-heading small){color:#9bb0aa}
:global(html[data-theme="dark"] .port-inputs input:disabled){color:#9bb0aa;background:#263a35;border-color:#3a514b}
:global(html[data-theme="dark"] .modal-card){color:#e8f3f0;background:#172321;border-color:#30413d}
:global(html[data-theme="dark"] .modal-card p){color:#9bb0aa}
@media(max-width:520px){.advanced-card{grid-column:auto}.port-inputs{grid-template-columns:1fr}}

/* Server settings are a short form, not a set of independent data feeds.
   Let each card keep its natural height so a few extra pixels do not create
   three nested scrollbars. The section itself is the only fallback scroll
   surface when a small viewport cannot show the complete form. */
.server-page{overflow-x:hidden;overflow-y:auto}
.server-page .settings-grid{flex:0 0 auto;min-height:auto;align-items:start;overflow:visible;grid-auto-rows:auto}
.server-page .settings-card{height:auto;min-height:0;overflow:visible;padding:16px;gap:12px}
.server-page .settings-card input{height:40px}
.server-page .settings-card .choice{padding:10px;gap:8px}
.server-page .settings-card .choice small{margin-top:3px}
.server-page .webrtc-port-fields{padding:12px;gap:8px}
.server-page .readonly-card{margin-top:12px;padding:14px 16px}
.server-page .readonly-card dl{gap:8px;margin-top:10px}

@media(max-width:850px){
  .server-page .settings-grid{overflow:visible;grid-auto-rows:auto}
  .server-page .settings-card{overflow:visible}
}

/* Mobile admin pages should read like one continuous form. Keep the desktop
   viewport shell untouched, but let the document grow vertically on narrow
   screens instead of trapping content inside cards and nested panes. */
@media(max-width:850px){
  :global(html),:global(body),:global(#app){height:auto;min-height:100%;max-height:none;overflow:auto}
  .admin-root{height:auto;min-height:100dvh;overflow:visible}
  .admin-shell{height:auto;min-height:100dvh;overflow:visible}
  .admin-main{height:auto;min-height:0;overflow:visible}
  .page-content{display:block;height:auto;min-height:0;overflow:visible}
  .login-page{height:auto;min-height:100dvh;overflow:visible}
  .login-card{max-height:none;overflow:visible}

  .overview-page{height:auto;min-height:0;overflow:visible}
  .overview-page .overview-columns{grid-template-rows:auto;overflow:visible}
  .overview-page .target-health-card,.overview-page .recent-events-card{height:auto;min-height:0;overflow:visible}
  .overview-page .recent-events-card .event-list{max-height:none;overflow:visible}

  .server-page{height:auto;min-height:0;overflow:visible}
  .server-page .settings-grid{height:auto;overflow:visible}

  .operations-page{height:auto;min-height:0;overflow:visible}
  .operations-page .operations-primary,.operations-page .lower-operations{height:auto;min-height:0;overflow:visible;grid-auto-rows:auto;flex:none}
  .operations-page .operation-card{height:auto;min-height:0;overflow:visible}
  .operations-primary .table-wrap{max-height:none;overflow-x:auto;overflow-y:visible}
  .operations-primary .invite-list{max-height:none;overflow:visible}
  .logs-card .log-list,.audit-card .event-list{max-height:none;overflow:visible;flex:none}
  .logs-card .log-list{width:100%;min-width:0}
  .logs-card .log-row{min-width:0;max-width:100%;overflow:hidden}
  .logs-card .log-row>div{width:0;max-width:100%;flex:1 1 auto;min-width:0;overflow:hidden}
  .logs-card .log-row strong,.logs-card .log-row small{overflow-wrap:anywhere;white-space:normal;word-break:break-word}
}

/* Long log messages should wrap on every screen size instead of widening the
   log card or introducing page-level horizontal scrolling. */
.logs-card .log-row{min-width:0}
.logs-card .log-row strong,.logs-card .log-row small{overflow-wrap:anywhere;white-space:normal;word-break:break-word}

.connection-list{display:grid;gap:7px;max-height:180px;margin-top:12px;overflow-y:auto}
.connection-history-heading{display:grid;gap:3px;padding:0 0 6px;border-bottom:1px solid #edf1ef}
.connection-history-heading strong{font-size:10px}
.connection-history-heading small{color:#899792;font-size:8px}
.connection-row{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:8px;background:#f6f9f8;border-radius:7px}
.connection-person,.connection-detail{min-width:0}
.connection-person{flex:1 1 auto}
.connection-person strong,.connection-person small,.connection-detail small{display:block;overflow-wrap:anywhere;word-break:break-word}
.connection-person strong{font-size:10px}
.connection-person small{margin-top:3px;color:#899792;font-size:8px}
.connection-detail{display:grid;flex:0 1 58%;justify-items:end;gap:2px;text-align:right}
.connection-detail small{color:#899792;font-size:8px}
.connection-status{display:inline-flex;padding:3px 6px;border-radius:999px;color:#236c63;background:#e3f3ef;font-size:8px;font-weight:800}
.connection-status.disconnected{color:#687a74;background:#e9efed}
.connection-status.failed{color:#a34f48;background:#fff0ee}
.connection-status.connecting{color:#8b6a3e;background:#fbf1dc}

@media(max-width:520px){
  .connection-row{display:grid;gap:7px}
  .connection-detail{justify-items:start;text-align:left}
}

.login-actions{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:20px;flex-wrap:wrap}
.login-actions .language-link{margin-top:0}
.home-link{display:inline-flex;align-items:center;gap:6px;padding:8px 12px;color:#08766e;background:#e4f3ef;border:1px solid #cae7e0;border-radius:8px;font-size:11px;font-weight:700;text-decoration:none}
.home-link:hover{background:#d8eee9}
.language-link{margin-top:20px!important;padding:0!important;background:transparent!important;border:0!important;border-radius:0!important}
.login-actions .language-link{margin-top:0!important}
</style>
