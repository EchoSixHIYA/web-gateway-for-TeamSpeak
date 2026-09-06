<template>
  <div class="web-client">
    <!-- Connection / welcome screen -->
    <section v-if="!voiceState.connected && !voiceState.reconnecting && !voiceState.reconnectFailed" class="join-page">
      <header class="join-header">
        <div class="brand-lockup">
          <img class="brand-mark" src="/网站图标.jpg" alt="WebSpeak" />
          <div>
            <strong>{{ siteName }}</strong>
            <small>{{ t('browserWorkspace') }}</small>
          </div>
        </div>
        <div class="header-tools"><div class="header-note"><span class="tiny-dot"></span> {{ t('secureGateway') }}</div><a class="github-button" href="https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak" target="_blank" rel="noreferrer" :title="t('githubRepository')" :aria-label="t('githubRepository')"><Icon name="github" :size="18" /><span>{{ t('githubRepository') }}</span></a><button type="button" class="qq-button" :title="t('qqGroup')" :aria-label="t('qqGroup')" aria-haspopup="dialog" @click="qqModalOpen = true"><Icon name="qq" :size="18" /><span class="qq-label">{{ t('qqGroup') }}</span></button><a class="bilibili-button" href="https://space.bilibili.com/25414873" target="_blank" rel="noreferrer" :title="t('bilibiliProfile')" :aria-label="t('bilibiliProfile')"><span class="bilibili-glyph">B</span><span class="bilibili-label">{{ t('bilibiliProfile') }}</span></a><span class="version-badge" :title="`${t('currentVersion')}: v${appVersion}`" :aria-label="`${t('currentVersion')}: v${appVersion}`">v{{ appVersion }}</span><a class="changelog-button" href="https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/blob/master/CHANGELOG.md" target="_blank" rel="noreferrer" :title="t('viewChangelog')" :aria-label="t('viewChangelog')"><Icon name="clock" :size="16" /><span>{{ t('viewChangelog') }}</span></a><a class="guide-button" href="/admin" :title="t('adminConsole')" :aria-label="t('adminConsole')"><Icon name="settings" :size="15" /><span>{{ t('adminConsole') }}</span></a><button type="button" class="header-action theme-toggle" :title="themeLabel" :aria-label="themeLabel" @click="cycleTheme"><Icon :name="themeIcon" :size="17" /></button><select v-model="language" class="language-select" :aria-label="t('languageMenu')" @change="persistLanguage"><option value="zh">中文</option><option value="en">English</option><option value="de">Deutsch</option></select></div>
      </header>

      <main class="join-content">
        <div class="join-copy">
          <div class="eyebrow"><span class="eyebrow-dot"></span> {{ t('privateAudio') }}</div>
          <h1>{{ t('joinLine1') }}<br /><em>{{ t('joinLine2') }}</em></h1>
          <p class="join-description">{{ localizedWelcomeText }}</p>
          <div class="promise-list">
            <div class="promise-item"><span class="promise-icon"><Icon name="waveform" :size="16" /></span><span><b>{{ t('highQuality') }}</b><small>{{ t('opusAudio') }}</small></span></div>
            <div class="promise-item"><span class="promise-icon mint"><Icon name="shield" :size="16" /></span><span><b>{{ t('secureJoin') }}</b><small>{{ t('inviteProtected') }}</small></span></div>
            <div class="promise-item"><span class="promise-icon sand"><Icon name="users" :size="16" /></span><span><b>{{ t('realtime') }}</b><small>{{ t('membersSync') }}</small></span></div>
          </div>
        </div>

        <div class="join-card">
          <div class="card-kicker">{{ t('joinServer') }}</div>
          <h2>{{ t('welcomeBack') }}</h2>
          <p class="card-lead">{{ t('joinLead') }}</p>

          <div v-if="voiceState.error" class="notice error-notice"><span class="notice-symbol">!</span><span>{{ localizedMessage(voiceState.error) }}</span></div>
          <div v-if="browserError" class="notice warning-notice"><span class="notice-symbol">i</span><span>{{ localizedMessage(browserError) }}</span></div>
          <div v-if="!serverConfigLoading && !initialized" class="notice warning-notice"><span class="notice-symbol">i</span><span>{{ t('notConfigured') }} <a href="/admin">{{ t('configureNow') }}</a></span></div>
          <div v-if="!localPersistenceAvailable" class="notice warning-notice"><span class="notice-symbol">i</span><span>{{ t('localPersistenceUnavailable') }}</span></div>

          <form v-if="initialized" class="join-form" @submit.prevent="doConnect">
            <div v-if="accessMode === 'open'" class="field-grid target-fields">
              <label class="field-label" for="server-address"><span>{{ t('serverAddress') }}</span><div class="field-wrap"><Icon name="server" :size="17" /><input id="server-address" v-model="serverHost" autocomplete="url" :placeholder="t('serverAddressPlaceholder')" /></div></label>
              <label class="field-label" for="server-port"><span>{{ t('serverPort') }}</span><div class="field-wrap"><Icon name="hash" :size="17" /><input id="server-port" v-model="serverPort" inputmode="numeric" type="text" maxlength="5" :placeholder="t('serverPortPlaceholder')" /></div></label>
            </div>
            <p v-if="accessMode === 'open'" class="field-hint">{{ t('serverAddressHint') }}</p>
            <div v-if="accessMode === 'open' && (favoriteServers.length || recentServers.length)" class="local-servers">
              <div v-if="favoriteServers.length" class="local-server-group"><span>{{ t('favoriteServers') }}</span><button v-for="favorite in favoriteServers" :key="favorite.id" type="button" @click="selectLocalServer(favorite.address, favorite.nickname)">{{ favorite.label }}</button></div>
              <div v-if="recentServers.length" class="local-server-group"><span>{{ t('recentServers') }}</span><button v-for="recent in recentServers" :key="recent.id" type="button" @click="selectLocalServer(recent.address, recent.nickname)">{{ recent.address }}</button></div>
            </div>
            <button v-if="accessMode === 'open' && serverHost.trim()" type="button" class="favorite-toggle" @click="toggleFavorite">{{ isFavorite ? t('removeFavorite') : t('saveFavorite') }}</button>

            <template v-if="accessMode === 'open'">
              <label class="field-label" for="server-password">{{ t('serverPassword') }} <span>{{ t('optional') }}</span></label>
              <div class="field-wrap"><Icon name="lock" :size="17" /><input id="server-password" v-model="serverPassword" type="password" autocomplete="off" :placeholder="t('optionalPassword')" /></div>
            </template>

            <label class="field-label" for="nickname">{{ t('nickname') }}</label>
            <div class="field-wrap">
              <Icon name="users" :size="17" />
              <input id="nickname" v-model="nickname" autocomplete="nickname" maxlength="30" :placeholder="t('nicknamePlaceholder')" autofocus />
            </div>

            <label class="field-label" for="channel">{{ t('targetChannel') }} <span>{{ t('optional') }}</span></label>
            <div class="field-wrap">
              <Icon name="hash" :size="17" />
              <input id="channel" v-model="channel" :placeholder="t('emptyDefault')" @keyup.enter="doConnect" />
            </div>

            <details class="identity-options"><summary>{{ t('identityOptions') }}</summary><label class="remember-identity"><input v-model="rememberIdentity" type="checkbox" /><span><strong>{{ t('rememberIdentity') }}</strong><small>{{ t('rememberIdentityHint') }}</small></span></label></details><p v-if="rememberIdentity" class="identity-warning">{{ t('rememberIdentityConcurrentWarning') }}</p>

            <button class="primary-button connect-button" :disabled="!canJoin || serverConfigLoading || !identityReady || voiceState.connecting" type="submit">
              <span v-if="voiceState.connecting" class="button-spinner"></span>
              <span>{{ voiceState.connecting ? t('connecting') : t('enterVoice') }}</span>
              <Icon v-if="!voiceState.connecting" name="chevron-right" :size="17" />
            </button>
            <button v-if="voiceState.connecting" type="button" class="cancel-connect-button" @click="doDisconnect">{{ t('cancel') }}</button>
          </form>
          <div class="join-meta"><Icon name="lock" :size="14" /> {{ t('connectionAuthorized') }}</div>
        </div>
      </main>

      <footer class="join-footer">
        <span>WebSpeak</span><span class="footer-separator">·</span><span>{{ t('teamSpeakClient') }}</span><span class="footer-spacer"></span><button type="button" class="clear-local-button" @click="clearBrowserData">{{ t('clearLocalData') }}</button><span class="footer-separator">·</span><span>{{ t('browserSupport') }}</span>
      </footer>

      <!-- QQ community modal -->
      <div v-if="qqModalOpen" class="modal-backdrop qq-modal-backdrop" @click.self="qqModalOpen = false">
        <section class="qq-modal-card" role="dialog" aria-modal="true" :aria-labelledby="'qq-group-title'">
          <button type="button" class="qq-modal-close" :aria-label="t('close')" :title="t('close')" @click="qqModalOpen = false"><Icon name="close" :size="19" /></button>
          <div class="qq-modal-heading"><span class="card-kicker">{{ t('qqGroup') }}</span><h2 id="qq-group-title">{{ t('qqGroup') }}</h2></div>
          <img class="qq-qr-image" src="/qq-group-qr.jpg" :alt="t('qqGroupQrAlt')" />
          <p class="qq-direct-join">{{ t('qqJoinDirect') }}</p>
          <a class="qq-join-link" :href="qqJoinUrl" :aria-label="t('joinQqGroup')" target="_blank" rel="noreferrer">{{ qqJoinUrl }}</a>
        </section>
      </div>
    </section>

    <!-- Connected application shell -->
    <div v-else :class="['app-shell', `mobile-view-${mobileSection}`]" @click="memberMenu = null">
      <main class="workspace">
        <header class="workspace-header">
          <div class="breadcrumbs"><span class="mobile-brand">TeamSpeak <em>Web</em></span><span class="crumb-muted">{{ t('serverBreadcrumb') }}</span><Icon name="chevron-right" :size="14" /><strong>{{ currentChannelName }}</strong></div>
          <div class="workspace-actions">
            <label v-if="channelTree.length" class="channel-switcher" :title="t('switchChannel')">
              <Icon name="volume" :size="15" />
              <select v-model="selectedChannelId" :aria-label="t('switchChannel')" @change="selectChannelById">
                <option v-for="channelItem in channelTree" :key="channelItem.id" :value="channelItem.id">{{ channelLabel(channelItem) }}</option>
              </select>
            </label>
            <button class="header-action" :title="t('copyInvite')" @click="doShare"><Icon name="share" :size="18" /></button>
            <button v-if="isMobileViewport" class="header-action microphone-header-toggle" :class="{ muted: microphoneMuted }" :title="microphoneMuted ? t('unmuteMic') : t('muteMic')" :aria-label="microphoneMuted ? t('microphoneMuted') : t('microphoneActive')" :aria-pressed="!microphoneMuted" @click="toggleMicrophone"><Icon :name="microphoneMuted ? 'mic-off' : 'mic'" :size="18" /></button>
            <button v-if="isMobileViewport" class="header-action" :title="t('audioSettings')" :aria-label="t('audioSettings')" @click="settingsOpen = true"><Icon name="settings" :size="18" /></button>
            <button type="button" class="header-action theme-toggle" :title="themeLabel" :aria-label="themeLabel" @click="cycleTheme"><Icon :name="themeIcon" :size="17" /></button>
            <select v-model="language" class="language-select workspace-language" :aria-label="t('languageMenu')" @change="persistLanguage"><option value="zh">中文</option><option value="en">English</option><option value="de">Deutsch</option></select>
            <button class="disconnect-button" @click="doDisconnect"><Icon name="door" :size="17" /><span>{{ t('exit') }}</span></button>
          </div>
        </header>

        <div v-if="voiceState.reconnecting || voiceState.reconnectFailed" :class="['reconnect-banner', { failed: voiceState.reconnectFailed }]" role="status">
          <div class="reconnect-copy"><strong>{{ voiceState.reconnectFailed ? t('reconnectFailed') : t('connectionInterrupted') }}</strong><span v-if="voiceState.reconnecting">{{ t('reconnectingAttempt', { attempt: voiceState.reconnectAttempt }) }}</span><span v-else>{{ localizedMessage(voiceState.error) }}</span></div>
          <div class="reconnect-actions"><button v-if="voiceState.reconnectFailed" type="button" class="secondary-button" @click="reconnectNow">{{ t('reconnectNow') }}</button><button type="button" class="text-button" @click="doDisconnect">{{ t('back') }}</button></div>
        </div>
        <div v-for="poke in visiblePokes" :key="poke.id" class="poke-banner" role="status"><Icon name="bell" :size="17" /><span><strong>{{ poke.invokerName }}</strong> {{ t('pokedYou') }}<small v-if="poke.message">：{{ poke.message }}</small></span><button type="button" @click="dismissPoke(poke.id)"><Icon name="close" :size="15" /></button></div>

        <div class="workspace-scroll">
          <div class="workspace-content">
            <section :class="['room-hero', { 'mobile-section-hidden': mobileSection !== 'channels' && mobileSection !== 'voice' }]">
              <div class="hero-decoration one"></div><div class="hero-decoration two"></div>
              <div class="room-hero-content">
                <div class="room-eyebrow"><span class="live-pill"><i></i> {{ t('live') }}</span><span>{{ t('voiceSpace') }}</span></div>
                <h1><Icon name="volume" :size="24" /> {{ currentChannelName }}</h1>
                <p>{{ currentChannelDescription || t('roomDescription') }}</p>
                <div class="room-stats"><span><Icon name="users" :size="15" /> {{ t('membersOnline', { count: currentMembers.length }) }}</span><span class="stat-divider"></span><span><Icon name="shield" :size="14" /> {{ t('encrypted') }}</span></div>
              </div>
              <div class="hero-visual" aria-hidden="true"><div class="orbit orbit-a"></div><div class="orbit orbit-b"></div><div class="hero-wave"><i v-for="bar in heroBars" :key="bar" :style="{ height: `${bar}px` }"></i></div></div>
            </section>

            <section :class="['voice-section', { 'mobile-section-hidden': mobileSection !== 'voice' }]">
              <div class="section-heading"><div><span class="section-kicker">{{ t('voiceActivity') }}</span><h2>{{ t('speakingNow') }}</h2></div><span class="section-counter">{{ t('onlineShort', { count: currentMembers.length }) }}</span></div>
              <div v-if="currentMembers.length" class="voice-grid">
                <article v-for="member in roomMembers" :key="member.id" :class="['voice-card', { speaking: isSpeaking(member), self: member.isSelf }]">
                  <button v-if="isMobileViewport && !member.isSelf" type="button" class="voice-member-action" :aria-label="t('moreMemberOptions')" @click.stop="openMemberActions(member)"><Icon name="more" :size="17" /></button>
                  <div class="voice-avatar-wrap"><div :class="['voice-avatar', { speaking: isSpeaking(member) }]" :style="avatarStyle(member.nickname, member.isSelf)">{{ avatarInitial(member.nickname) }}</div></div>
                  <strong>{{ member.isSelf ? t('you') : member.nickname }}</strong><span>{{ isSpeaking(member) ? t('speaking') : member.isSelf ? t('connectedYou') : t('connected') }}</span>
                </article>
                <article v-if="currentMembers.length > roomMembers.length" class="voice-card more-card"><div class="more-count">+{{ currentMembers.length - roomMembers.length }}</div><strong>{{ t('moreMembers') }}</strong><span>{{ t('viewLeft') }}</span></article>
              </div>
              <div v-else class="voice-empty"><span class="empty-icon"><Icon name="users" :size="20" /></span><strong>{{ t('waitingForMembers') }}</strong><span>{{ t('prepareMicrophone') }}</span></div>
              <div v-if="whisperTargetIds.size" class="whisper-strip">
                <div class="whisper-strip-copy"><strong><Icon name="users" :size="15" /> {{ t('whisperTargets') }}</strong><span>{{ whisperTargets.map((member) => member.nickname).join('、') }}</span></div>
                <button type="button" class="text-button" @click="clearWhisperTargets">{{ t('clearWhisperTargets') }}</button>
                <button type="button" class="whisper-ptt-button" :class="{ active: whisperPttActive || whisperActive }" :aria-pressed="whisperPttActive || whisperActive" @pointerdown.prevent="onWhisperPttDown" @pointerup.prevent="onWhisperPttUp" @pointercancel.prevent="onWhisperPttUp" @lostpointercapture="onWhisperPttUp"><Icon name="mic" :size="18" /> {{ whisperPttActive || whisperActive ? t('releaseWhisper') : t('whisperHoldToTalk') }}</button>
              </div>
              <div class="mobile-voice-controls">
                <button type="button" class="mobile-voice-toggle" :class="{ muted: microphoneMuted }" :aria-pressed="!microphoneMuted" @click="toggleMicrophone"><Icon :name="microphoneMuted ? 'mic-off' : 'mic'" :size="18" /><span>{{ microphoneMuted ? t('unmuteMic') : t('muteMic') }}</span></button>
                <button type="button" class="mobile-voice-settings" @click="settingsOpen = true"><Icon name="settings" :size="17" /><span>{{ t('audioSettings') }}</span></button>
              </div>
            </section>

            <section :class="['chat-panel', { 'mobile-section-hidden': mobileSection !== 'chat' }]">
              <div class="chat-tabs" role="tablist" :aria-label="t('chatTabs')">
                <button type="button" :class="{ active: chatTab === 'channel' }" @click="chatTab = 'channel'"><Icon name="hash" :size="15" /> {{ currentChannelName }}</button>
                <button type="button" :class="{ active: chatTab === 'server' }" @click="chatTab = 'server'"><Icon name="server" :size="15" /> {{ t('serverChat') }}</button>
                <button v-for="conversation in privateConversations" :key="conversation.id" type="button" :class="{ active: chatTab === 'private' && privateClientId === conversation.id }" @click="openPrivateChat(conversation.id)"><Icon name="message" :size="15" /> {{ conversation.name }}</button>
                <button type="button" :class="{ active: chatTab === 'events' }" @click="chatTab = 'events'"><Icon name="bell" :size="15" /> {{ t('eventLog') }}</button>
              </div>
              <div class="section-heading chat-heading"><div><span class="section-kicker">{{ chatTabLabel }}</span><h2><Icon :name="chatTab === 'server' ? 'server' : chatTab === 'events' ? 'bell' : chatTab === 'private' ? 'message' : 'hash'" :size="20" /> {{ chatTitle }}</h2></div><span class="section-counter">{{ chatTab === 'events' ? t('eventCount', { count: serverEvents.length }) : t('messageCount', { count: visibleChatMessages.length }) }}</span></div>
              <div ref="chatListEl" class="message-list">
                <div v-if="chatTab === 'events'">
                  <article v-for="event in serverEvents" :key="event.id" class="event-row"><time>{{ formatTime(event.timestamp) }}</time><span>{{ event.message }}</span></article>
                  <div v-if="!serverEvents.length" class="chat-empty"><div class="chat-empty-icon"><Icon name="bell" :size="24" /></div><strong>{{ t('noEvents') }}</strong><span>{{ t('noEventsLead') }}</span></div>
                </div>
                <div v-else-if="!visibleChatMessages.length" class="chat-empty"><div class="chat-empty-icon"><Icon name="message" :size="24" /></div><strong>{{ chatTab === 'private' ? t('privateChatStart') : t('chatStart') }}</strong><span>{{ chatTab === 'private' ? t('privateChatStartLead') : t('chatStartLead') }}</span></div>
                <template v-for="message in visibleChatMessages" :key="message.id">
                  <article v-if="chatTab !== 'events'" :class="['message-row', { mine: message.isSelf }]">
                  <div class="message-avatar" :style="avatarStyle(message.invokerName, message.isSelf)">{{ avatarInitial(message.invokerName) }}</div>
                  <div class="message-body"><div class="message-meta"><strong>{{ message.isSelf ? t('you') : message.invokerName }}</strong><time>{{ formatTime(message.timestamp) }}</time></div><div class="message-bubble">{{ message.message }}</div></div>
                  </article>
                </template>
              </div>
               <form v-if="chatTab !== 'events'" class="message-composer" @submit.prevent="submitMessage">
                 <input v-model="messageDraft" maxlength="500" :placeholder="chatPlaceholder" :aria-label="t('send')" />
                 <button class="send-button" type="submit" :disabled="!messageDraft.trim()" :title="t('send')"><Icon name="send" :size="18" /></button>
               </form>
             </section>
          </div>
        </div>

      </main>

      <aside :class="['member-panel', { 'mobile-section-visible': mobileSection === 'channels' }]">
        <div class="member-panel-heading"><div><span class="section-kicker">{{ t('people') }}</span><h2>{{ t('people') }}</h2></div><button type="button" class="status-button" :class="{ active: away }" @click="toggleAway"><span class="status-dot"></span>{{ away ? t('away') : t('available') }}</button></div>
        <div class="member-search"><Icon name="search" :size="15" /><input v-model="memberQuery" :placeholder="t('searchMembers')" :aria-label="t('searchMembers')" /></div>
        <div class="member-tree">
          <section v-for="channelItem in filteredMemberChannels" :key="channelItem.id" :class="['member-channel-group', { current: currentChannel?.id === channelItem.id }]" :style="{ marginLeft: `${channelItem.depth * 10}px` }">
            <button class="member-channel-heading" :title="t('switchChannel')" @click="selectChannel(channelItem)">
              <Icon name="volume" :size="16" />
              <span>{{ channelItem.name }}</span>
              <small>{{ channelItem.members.length }}</small>
            </button>
            <div v-if="channelItem.members.length" class="member-list">
              <div v-for="member in channelItem.members" :key="`${channelItem.id}-${member.id}`" class="member-row" @contextmenu.prevent="openMemberMenu(member, $event)">
                <div :class="['member-avatar', { speaking: isSpeaking(member) }]" :style="avatarStyle(member.nickname, member.isSelf)">{{ avatarInitial(member.nickname) }}<span class="member-presence"></span></div>
                <div class="member-copy"><strong>{{ memberDisplayName(member) }}</strong><span>{{ member.away ? t('away') : isSpeaking(member) ? t('speaking') : member.isSelf ? t('yourDevice') : t('memberOnline') }}</span></div>
                <div class="member-flags" :aria-label="t('memberStates')"><span v-if="member.away" :title="t('away')" :aria-label="t('away')"><Icon name="clock" :size="13" /></span><span v-if="member.inputMuted" :title="t('inputMuted')" :aria-label="t('inputMuted')"><Icon name="mic-off" :size="13" /></span><span v-if="member.outputMuted" :title="t('outputMuted')" :aria-label="t('outputMuted')"><Icon name="volume-off" :size="13" /></span><span v-if="member.channelCommander" :title="t('channelCommander')" :aria-label="t('channelCommander')"><Icon name="shield" :size="13" /></span></div>
                <div class="member-volume"><Icon :name="(volumes[member.id] ?? 1) === 0 ? 'volume-off' : 'volume'" :size="14" /><input type="range" min="0" max="400" :value="(volumes[member.id] ?? 1) * 100" :style="rangeStyle((volumes[member.id] ?? 1) / 4, 1)" :aria-label="t('memberVolume')" @input="onVolInput(member.id, $event)" /></div>
                <button v-if="isMobileViewport && !member.isSelf" type="button" class="member-action-button" :aria-label="t('moreMemberOptions')" @click.stop="openMemberActions(member)"><Icon name="more" :size="18" /></button>
              </div>
            </div>
            <div v-else class="channel-no-members">{{ t('noMembersInChannel') }}</div>
          </section>
        </div>
        <div v-if="!filteredMemberChannels.length" class="member-empty">{{ t('noMatchingMembers') }}</div>
        <div v-if="!isMobileViewport" class="desktop-audio-dock" role="toolbar" :aria-label="t('desktopAudioControls')">
          <div class="desktop-audio-dock-copy"><strong>{{ t('desktopAudioControls') }}</strong><span>{{ accompanimentActive ? t('accompanimentActive') : t('volumeTip') }}</span></div>
          <div class="desktop-audio-dock-actions">
            <button type="button" class="dock-audio-button microphone-header-toggle" :class="{ muted: microphoneMuted }" :title="microphoneMuted ? t('unmuteMic') : t('muteMic')" :aria-label="microphoneMuted ? t('microphoneMuted') : t('microphoneActive')" :aria-pressed="!microphoneMuted" @click="toggleMicrophone"><Icon :name="microphoneMuted ? 'mic-off' : 'mic'" :size="18" /></button>
            <button type="button" class="dock-audio-button" :title="t('audioSettings')" :aria-label="t('audioSettings')" @click="settingsOpen = true"><Icon name="settings" :size="18" /></button>
            <button type="button" class="dock-audio-button accompaniment-toggle" :class="{ active: accompanimentActive }" :title="accompanimentActive ? t('stopAccompaniment') : t('startAccompaniment')" :aria-label="accompanimentActive ? t('stopAccompaniment') : t('startAccompaniment')" :aria-pressed="accompanimentActive" @click="toggleAccompaniment"><Icon name="music" :size="18" /></button>
          </div>
        </div>
      </aside>

      <section v-if="mobileSection === 'more'" class="mobile-more-panel">
        <span class="section-kicker">{{ t('mobileMore') }}</span>
        <h2>{{ t('mobileMore') }}</h2>
        <button type="button" :class="{ muted: microphoneMuted }" @click="toggleMicrophone"><Icon :name="microphoneMuted ? 'mic-off' : 'mic'" :size="18" /> {{ microphoneMuted ? t('unmuteMic') : t('muteMic') }}</button>
        <button type="button" @click="settingsOpen = true"><Icon name="settings" :size="18" /> {{ t('audioSettings') }}</button>
        <button type="button" @click="cycleTheme"><Icon :name="themeIcon" :size="18" /> {{ themeLabel }}</button>
        <label class="language-menu-row"><Icon name="globe" :size="18" /><span>{{ t('languageMenu') }}</span><select v-model="language" class="language-select" :aria-label="t('languageMenu')" @change="persistLanguage"><option value="zh">中文</option><option value="en">English</option><option value="de">Deutsch</option></select></label>
        <button type="button" class="danger" @click="doDisconnect"><Icon name="door" :size="18" /> {{ t('exit') }}</button>
      </section>

      <nav class="mobile-nav" :aria-label="t('mobileNavigation')">
        <button type="button" :class="{ active: mobileSection === 'channels' }" @click="mobileSection = 'channels'"><Icon name="volume" :size="18" /><span>{{ t('mobileChannels') }}</span></button>
        <button type="button" :class="{ active: mobileSection === 'chat' }" @click="mobileSection = 'chat'"><Icon name="message" :size="18" /><span>{{ t('mobileChat') }}</span></button>
        <button type="button" :class="{ active: mobileSection === 'voice' }" @click="mobileSection = 'voice'"><Icon name="mic" :size="18" /><span>{{ t('mobileVoice') }}</span></button>
        <button type="button" :class="{ active: mobileSection === 'more' }" @click="mobileSection = 'more'"><Icon name="more" :size="18" /><span>{{ t('mobileMore') }}</span></button>
      </nav>
    </div>

    <div v-if="memberMenu && isMobileViewport" class="member-menu-backdrop" @click="memberMenu = null"></div>
    <div v-if="memberMenu" class="member-context-menu" :style="memberMenuStyle" @click.stop>
      <div class="member-menu-header"><strong>{{ memberMenu.member.nickname }}</strong><button type="button" class="member-menu-close" :aria-label="t('close')" @click="memberMenu = null"><Icon name="close" :size="17" /></button></div>
      <label class="menu-volume"><span>{{ t('memberVolume') }}</span><input type="range" min="0" max="400" :value="(volumes[memberMenu.member.id] ?? 1) * 100" :style="rangeStyle((volumes[memberMenu.member.id] ?? 1) / 4, 1)" :aria-label="t('memberVolume')" @input="onVolInput(memberMenu.member.id, $event)" /></label>
      <button type="button" @click="openPrivateChat(memberMenu.member.id); memberMenu = null"><Icon name="message" :size="15" /> {{ t('privateMessage') }}</button>
      <button type="button" @click="pokeMember(memberMenu.member); memberMenu = null"><Icon name="bell" :size="15" /> {{ t('poke') }}</button>
      <button type="button" @click="toggleWhisperTarget(memberMenu.member); memberMenu = null"><Icon name="mic" :size="15" /> {{ whisperTargetIds.has(memberMenu.member.id) ? t('removeWhisperTarget') : t('setWhisperTarget') }}</button>
      <button type="button" @click="copyMemberName(memberMenu.member); memberMenu = null"><Icon name="copy" :size="15" /> {{ t('copyNickname') }}</button>
    </div>

    <!-- Audio settings modal -->
    <div v-if="settingsOpen" class="modal-backdrop" @click.self="settingsOpen = false">
      <section class="settings-modal" role="dialog" aria-modal="true" :aria-labelledby="'settings-title'">
        <div class="settings-main"><header class="settings-header"><h2 id="settings-title">{{ t('audioConfiguration') }}</h2><button class="round-icon" :title="t('close')" @click="settingsOpen = false"><Icon name="close" :size="19" /></button></header><div class="settings-content">
          <section class="settings-section"><h3><Icon name="mic" :size="20" /> {{ t('inputDevice') }}</h3><label class="settings-label" for="input-device">{{ t('microphone') }}</label><select id="input-device" class="settings-select" :value="selectedInputDeviceId" :disabled="!inputDevices.length" @change="onInputDeviceChange"><option value="">{{ t('defaultMicrophone') }}</option><option v-for="(device, index) in inputDevices" :key="device.deviceId || `microphone-${index}`" :value="device.deviceId">{{ device.label || t('microphoneNumber', { index: index + 1 }) }}</option></select><p v-if="audioSettingsError" class="settings-error">{{ localizedMessage(audioSettingsError) }}</p><p class="audio-diagnostic"><span>{{ t('permission') }}</span><strong :class="`permission-${audioPermission}`">{{ audioPermission === 'granted' ? t('permissionGranted') : audioPermission === 'denied' ? t('permissionDenied') : t('permissionUnknown') }}</strong></p><div class="microphone-control"><div><label class="settings-label">{{ t('microphoneState') }}</label><p class="settings-hint">{{ microphoneMuted ? t('microphoneMutedHint') : t('microphoneActiveHint') }}</p></div><button type="button" class="microphone-toggle" :class="{ muted: microphoneMuted }" :aria-pressed="!microphoneMuted" @click="toggleMicrophone"><Icon :name="microphoneMuted ? 'mic-off' : 'mic'" :size="16" /> {{ microphoneMuted ? t('unmuteMic') : t('muteMic') }}</button></div><div class="settings-range-row"><label class="settings-label">{{ t('inputVolume') }}</label><strong>{{ Math.round(inputVolume * 100) }}%</strong></div><input class="settings-range" type="range" min="0" max="100" :value="inputVolume * 100" :style="rangeStyle(inputVolume, 1)" :aria-label="t('inputVolume')" @input="onInputVolume" /><div class="settings-range-row"><label class="settings-label">{{ t('voxThreshold') }}</label><strong>{{ (voxThreshold * 100).toFixed(1) }}%</strong></div><input class="settings-range" type="range" min="1" max="80" :value="voxThreshold * 1000" :style="rangeStyle(voxThreshold, 0.08)" :aria-label="t('voxThreshold')" @input="onVoxThreshold" /><div class="audio-level-row"><span>{{ t('micLevel') }}</span><strong>{{ Math.round(micLevel * 100) }}%</strong></div><div class="audio-level-track"><i :style="{ width: `${Math.round(micLevel * 100)}%` }"></i></div><div class="mic-test"><div class="mic-test-header"><strong>{{ t('microphoneTest') }}</strong><button type="button" @click="toggleMicTest">{{ microphoneTestActive ? t('stopTest') : t('startTest') }}</button></div><div class="meter"><i v-for="index in 24" :key="index" :class="{ active: microphoneTestActive && index <= micMeterBars }" :style="{ height: `${meterBarHeight(index) }px` }"></i></div><div class="meter-labels"><span>{{ t('silence') }}</span><span>{{ t('optimal') }}</span><span>{{ t('loud') }}</span></div><p class="settings-hint">{{ t('localMicTestHint') }}</p><audio v-if="testAudioUrl" class="test-audio" :src="testAudioUrl" controls :aria-label="t('microphoneTest')"></audio></div></section>
          <div class="settings-separator"></div><section class="settings-section"><h3><Icon name="volume" :size="20" /> {{ t('outputVolume') }}</h3><label v-if="outputDeviceSupported" class="settings-label" for="output-device">{{ t('outputDevice') }}</label><select v-if="outputDeviceSupported" id="output-device" class="settings-select" :value="selectedOutputDeviceId" :disabled="!outputDevices.length" @change="onOutputDeviceChange"><option value="">{{ t('defaultOutput') }}</option><option v-for="(device, index) in outputDevices" :key="device.deviceId || `speaker-${index}`" :value="device.deviceId">{{ device.label || t('speakerNumber', { index: index + 1 }) }}</option></select><p v-else class="mode-note"><Icon name="info" :size="16" /><span>{{ t('outputDeviceUnsupported') }}</span></p><div class="settings-range-row"><label class="settings-label">{{ t('speakers') }}</label><strong>{{ Math.round(outputVolume * 100) }}%</strong></div><input class="settings-range" type="range" min="0" max="100" :value="outputVolume * 100" :style="rangeStyle(outputVolume, 1)" :aria-label="t('outputVolume')" @input="onOutputVolume" /><div class="settings-range-row"><label class="settings-label">{{ t('notificationVolume') }}</label><strong>{{ Math.round(notificationVolume * 100) }}%</strong></div><input class="settings-range" type="range" min="0" max="100" :value="notificationVolume * 100" :style="rangeStyle(notificationVolume, 1)" :aria-label="t('notificationVolume')" @input="onNotificationVolume" /><div class="audio-diagnostic"><span>{{ t('audioStatus') }}</span><strong>{{ audioContextState === 'running' ? t('audioReady') : audioContextState === 'suspended' ? t('audioSuspended') : t('audioUnknown') }}</strong></div><div class="mode-note"><Icon name="shield" :size="16" /><span>{{ t('audioPrivacy') }}</span></div></section>
        </div><footer class="settings-footer"><button class="primary-button save-button" @click="settingsOpen = false">{{ t('done') }}</button></footer></div>
      </section>
    </div>

    <div v-if="toast" class="toast"><Icon name="check" :size="16" /> {{ toast }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import Icon from "../components/Icon.vue";
import { useVoiceWebSocket, type ChannelInfo, type ChannelMember } from "../composables/useVoiceWebSocket.js";
import { clearLocalData as clearStoredLocalData, isLocalPersistenceAvailable, listFavorites, listRecentServers, loadLocalPreferences, loadStoredIdentity, recordRecentServer, removeFavorite, removeStoredIdentity, saveFavorite, saveLocalPreferences, saveStoredIdentity, type FavoriteServer, type RecentServer } from "../services/local-persistence.js";
import { applyTheme, getStoredTheme, isDarkTheme, nextTheme, saveTheme, type ThemeMode } from "../services/theme.js";
import { combineTeamSpeakTarget, DEFAULT_TEAM_SPEAK_PORT, isValidTeamSpeakPort, splitTeamSpeakTarget } from "../services/teamspeak-target.js";

interface TreeChannel extends ChannelInfo {
  depth: number;
  members: ChannelMember[];
}

const {
  state: voiceState,
  members,
  channels,
  chatMessages,
  serverEvents,
  pokeNotifications,
  microphoneMuted,
  inputVolume,
  outputVolume,
  notificationVolume,
  voxThreshold,
  inputDevices,
  outputDevices,
  selectedInputDeviceId,
  selectedOutputDeviceId,
  outputDeviceSupported,
  audioPermission,
  audioContextState,
  identityMaterial,
  micLevel,
  microphoneTestActive,
  testAudioUrl,
  speakingIds,
  volumes,
  whisperTargetIds,
  whisperActive,
  setVolume,
  setInputVolume,
  setOutputVolume,
  setVoxThreshold,
  setNotificationVolume,
  prepareInputDevices,
  refreshAudioDevices,
  setInputDevice,
  setOutputDevice,
  startMicrophoneTest,
  stopMicrophoneTest,
  playNotification,
  connect,
  reconnectNow,
  disconnect,
  switchChannel,
  sendTextMessage,
  sendServerMessage,
  sendPrivateMessage,
  sendPoke,
  setAway,
  setWhisperTargets,
  setWhisperActive,
  setMicrophoneMuted,
  accompanimentActive,
  accompanimentErrorCode,
  startAccompaniment,
  stopAccompaniment,
  checkSupport,
  clearError,
} = useVoiceWebSocket();

const query = new URLSearchParams(location.search);
const initialChannel = query.get("channel") ?? "";
const inviteToken = query.get("invite") ?? "";
const initialTarget = initialServerTarget();
const nickname = ref(localStorage.getItem("webspeak:nickname") ?? "");
const channel = ref(initialChannel);
const serverHost = ref(initialTarget.address);
const serverPort = ref(initialTarget.port);
const serverPassword = ref("");
const accessMode = ref<"fixed" | "open">("fixed");
const rememberIdentity = ref(localStorage.getItem("webspeak:remember-identity") === "1");
const favoriteServers = ref<FavoriteServer[]>([]);
const recentServers = ref<RecentServer[]>([]);
const initialized = ref(false);
const siteName = ref("WebSpeak");
const welcomeTextZh = ref("");
const welcomeTextEn = ref("");
const appVersion = ref("0.1.2");
const browserError = ref("");
const serverConfigLoading = ref(true);
const memberQuery = ref("");
const messageDraft = ref("");
const selectedChannelId = ref("");
const settingsOpen = ref(false);
const qqModalOpen = ref(false);
const qqJoinUrl = "http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=yhumUMDD9PmyYFWdXWUb_x7hM5trFQY8&authKey=Pw3HBGT7GwMinTQnuFGfnpf0aRSzXOJKcAiujVP1%2BXMpjheAKrncTRivicBJxpjV&noverify=0&group_code=869500475";
const audioSettingsError = ref("");
const toast = ref("");
const chatListEl = ref<HTMLElement | null>(null);
const localPersistenceAvailable = isLocalPersistenceAvailable();
const identityReady = ref(!localPersistenceAvailable);
const chatTab = ref<"channel" | "server" | "private" | "events">("channel");
const privateClientId = ref(0);
const away = ref(false);
const awayMessage = ref("");
const memberMenu = ref<{ member: ChannelMember; x: number; y: number } | null>(null);
const mobileSection = ref<"channels" | "chat" | "voice" | "more">("channels");
const isMobileViewport = ref(false);
const whisperPttActive = ref(false);
let toastTimer: ReturnType<typeof setTimeout> | undefined;

type Language = "zh" | "en" | "de";
const language = ref<Language>(getInitialLanguage());
const themeMode = ref<ThemeMode>(getStoredTheme());
const themeIcon = computed(() => isDarkTheme(themeMode.value) ? "sun" : "moon");
const themeLabel = computed(() => isDarkTheme(themeMode.value) ? t("switchToLightTheme") : t("switchToDarkTheme"));
const localizedWelcomeText = computed(() => (language.value === "en" ? welcomeTextEn.value : welcomeTextZh.value) || t("joinDescription"));
applyTheme(themeMode.value);
const translations: Record<string, Record<string, string>> = {
  zh: {
    themeSystem: "跟随系统",
    themeLight: "浅色主题",
    themeDark: "深色主题",
    switchToLightTheme: "切换到浅色主题",
    switchToDarkTheme: "切换到深色主题",
    browserWorkspace: "浏览器语音工作台",
    secureGateway: "安全语音网关",
    adminConsole: "管理控制台",
    currentVersion: "当前版本",
    viewChangelog: "查看更新日志",
    notConfigured: "WebSpeak 尚未配置 TeamSpeak 目标。",
    configureNow: "打开管理控制台",
    privateAudio: "私密社区语音",
    joinLine1: "连接服务器，",
    joinLine2: "马上开始交流。",
    joinDescription: "无需安装 TeamSpeak 客户端，打开浏览器即可加入语音频道。低延迟、轻量、专注于每一次对话。",
    highQuality: "高质量语音",
    opusAudio: "Opus 低延迟传输",
    secureJoin: "安全加入",
    inviteProtected: "邀请链接保护你的服务器",
    realtime: "实时协作",
    membersSync: "频道成员状态即时同步",
    privateServer: "私密语音服务器",
    mainNav: "主导航",
    memberVolume: "成员音量",
    joinServer: "加入你的服务器",
    welcomeBack: "欢迎回来",
    joinLead: "输入一个昵称，选择进入的频道。",
    serverAddress: "TeamSpeak 服务器地址",
    serverAddressPlaceholder: "例如：ts.example.com 或 127.0.0.1",
    serverPort: "语音端口",
    serverPortPlaceholder: "9987",
    serverAddressHint: "这是网关服务器连接的 TeamSpeak 地址和端口，不是浏览器直接连接地址。",
    nickname: "你的昵称",
    nicknamePlaceholder: "例如：Alex Rivera",
    targetChannel: "目标频道",
    optional: "可选",
    emptyDefault: "留空进入默认频道",
    rememberIdentity: "记住此设备的 TeamSpeak 身份",
    rememberIdentityHint: "仅保存在本设备，用于下次连接时保持身份。",
    rememberIdentityConcurrentWarning: "同一浏览器只能同时使用一条保持身份的连接；要开启第二条，请取消勾选或使用另一个浏览器。",
    identityOptions: "设备身份选项",
    localPersistenceUnavailable: "当前浏览器无法使用持久化存储，本次将使用临时身份。",
    favoriteServers: "常用服务器",
    recentServers: "最近连接",
    saveFavorite: "保存到常用",
    removeFavorite: "移除常用",
    savedFavoriteToast: "已保存到常用服务器",
    removedFavoriteToast: "已从常用服务器移除",
    clearLocalData: "清除本地数据",
    clearLocalDataConfirm: "确定清除本设备保存的身份、收藏、最近连接和音频偏好吗？",
    localDataCleared: "本地数据已清除",
    connecting: "正在连接…",
    enterVoice: "进入语音空间",
    connectionAuthorized: "连接信息仅用于本次语音会话",
    githubRepository: "GitHub 仓库",
    qqGroup: "QQ群",
    qqGroupQrAlt: "QQ群二维码",
    qqJoinDirect: "或通过群聊链接直接加入",
    joinQqGroup: "点击加入QQ群",
    bilibiliProfile: "Bilibili 个人空间",
    browserSupport: "Chrome / Edge 94+",
    teamSpeakClient: "TeamSpeak 浏览器客户端",
    home: "首页",
    activity: "动态",
    server: "服务器",
    discover: "发现",
    downloads: "下载",
    help: "帮助",
    needHelp: "需要帮助？请联系服务器管理员",
    serverOptions: "更多服务器选项",
    online: "在线",
    audioSettings: "音频设置",
    desktopAudioControls: "音频控制",
    startAccompaniment: "共享伴奏",
    stopAccompaniment: "停止伴奏",
    accompanimentStarted: "伴奏共享已开始",
    accompanimentStopped: "伴奏共享已停止",
    accompanimentActive: "伴奏共享中",
    accompanimentNeedsWebRtc: "伴奏功能需要启用 WebRTC",
    accompanimentNoAudio: "所选来源没有可共享音频，请重新选择并勾选共享音频",
    accompanimentPermissionDenied: "无法获取伴奏音频，请允许屏幕共享并勾选共享音频",
    accompanimentUnsupported: "当前浏览器不支持伴奏共享",
    serverPassword: "服务器密码",
    optionalPassword: "没有密码可留空",
    switchChannel: "切换频道",
    searchChannels: "搜索频道",
    voiceChannels: "语音频道",
    peopleOnline: "{{count}} 人在线",
    channelPreparing: "频道列表准备中",
    channelPreparingLead: "服务器未提供频道目录时，仍可正常使用语音连接。",
    reload: "重新加载",
    quickActions: "快捷操作",
    inviteFriends: "邀请朋友加入",
    audioAndMic: "音频与麦克风",
    stableConnection: "连接稳定",
    websocket: "WebSocket",
    serverBreadcrumb: "服务器",
    copyInvite: "复制邀请链接",
    exit: "退出",
    live: "直播中",
    voiceSpace: "语音空间",
    roomDescription: "在这里和频道成员保持清晰、自然的交流。",
    membersOnline: "{{count}} 位成员在线",
    encrypted: "加密连接",
    voiceActivity: "语音活动",
    speakingNow: "正在语音中",
    onlineShort: "{{count}} 在线",
    you: "你",
    selfSuffix: "（你）",
    connected: "已连接",
    speaking: "正在说话…",
    connectedYou: "已连接 · 你",
    waitingForMembers: "等待成员加入语音",
    prepareMicrophone: "你可以先在这里准备好麦克风。",
    moreMembers: "更多成员",
    viewLeft: "在左侧查看",
    textChannel: "文字频道",
    channelChat: "{{channel}} 聊天",
    messageCount: "{{count}} 条消息",
    chatStart: "这是聊天的开始",
    chatStartLead: "发送一条消息，和频道里的朋友打个招呼吧。",
    chatTabs: "聊天标签",
    serverChat: "服务器",
    privateMessage: "私聊",
    privateMessagePlaceholder: "发送私聊消息…",
    serverMessagePlaceholder: "发送服务器消息…",
    channelPasswordPrompt: "请输入频道密码",
    privateChatStart: "这是私聊的开始",
    privateChatStartLead: "发送一条私聊消息。",
    eventLog: "事件日志",
    eventCount: "{{count}} 条事件",
    noEvents: "暂无服务器事件",
    noEventsLead: "频道和成员变化会显示在这里。",
    available: "在线",
    away: "离开",
    awayPrompt: "离开状态说明（可选）",
    poke: "戳一戳",
    pokedYou: "戳了你一下",
    pokeMessagePrompt: "戳一戳消息（可选）",
    pokeSent: "已发送戳一戳",
    copyNickname: "复制昵称",
    copiedNickname: "昵称已复制",
    attachmentUnavailable: "附件暂不可用",
    emojiUnavailable: "表情暂不可用",
    sendMessagePlaceholder: "发送消息给频道成员…",
    send: "发送",
    muteMic: "闭麦",
    unmuteMic: "开麦",
    microphoneActive: "麦克风已开启",
    microphoneMuted: "麦克风已关闭",
    microphoneActiveHint: "关闭麦克风后不会向服务器发送声音",
    microphoneMutedHint: "麦克风已关闭，其他人听不到你的声音",
    sending: "正在发送",
    exitVoice: "退出语音",
    people: "成员",
    searchMembers: "搜索成员",
    onlineGroup: "在线 — {{count}}",
    yourDevice: "你的设备",
    memberOnline: "在线",
    memberStates: "成员状态",
    inputMuted: "已禁用麦克风",
    outputMuted: "已禁用扬声器",
    channelCommander: "频道指挥官",
    noMatchingMembers: "没有找到匹配的成员",
    noMembersInChannel: "此频道暂无成员",
    volumeTip: "拖动成员右侧滑杆，单独调整听到的音量。",
    moreMemberOptions: "更多成员选项",
    connectedToast: "当前已连接到此服务器",
    connectionInterrupted: "连接已中断，正在尝试恢复…",
    reconnectingAttempt: "第 {{attempt}} 次重连",
    reconnectFailed: "无法恢复连接",
    reconnectNow: "立即重连",
    back: "返回",
    volumeToast: "成员音量可以在列表中单独调整",
    copiedToast: "邀请链接已复制",
    copyFailedToast: "复制失败，请手动复制浏览器地址",
    leftToast: "已安全退出语音空间",
    focusedToast: "当前版本聚焦于语音工作台",
    settings: "设置",
    profile: "个人资料",
    privacy: "隐私",
    notifications: "通知",
    browserClient: "浏览器客户端",
    audioConfiguration: "音频配置",
    inputDevice: "输入设备",
    microphone: "麦克风",
    microphoneState: "麦克风状态",
    defaultMicrophone: "默认浏览器麦克风",
    microphoneNumber: "麦克风 {{index}}",
    speakerNumber: "扬声器 {{index}}",
    permission: "权限",
    permissionUnknown: "尚未请求",
    permissionGranted: "已允许",
    permissionDenied: "已拒绝",
    inputVolume: "输入音量",
    voxThreshold: "语音激活阈值",
    micLevel: "麦克风音量",
    microphoneTest: "麦克风测试",
    stopTest: "停止测试",
    startTest: "开始测试",
    localMicTestHint: "本地测试：录音只在浏览器中播放，不会发送到 TeamSpeak。",
    silence: "安静",
    optimal: "最佳",
    loud: "较响",
    outputDevice: "输出设备",
    speakers: "扬声器 / 耳机",
    defaultOutput: "默认浏览器输出",
    outputVolume: "输出音量",
    outputDeviceUnsupported: "当前浏览器不支持扬声器设备选择，将使用默认输出设备。",
    notificationVolume: "通知音量",
    audioStatus: "音频状态",
    audioReady: "音频已就绪",
    audioSuspended: "音频被浏览器暂停",
    audioUnknown: "尚未初始化",
    audioPrivacy: "WebSpeak 会在浏览器安全上下文中处理音频，不会保存录音。",
    mobileNavigation: "移动端导航",
    mobileChannels: "频道",
    mobileChat: "聊天",
    mobileVoice: "语音",
    mobileMore: "更多",
    whisperTargets: "私语目标",
    setWhisperTarget: "设为私语目标",
    removeWhisperTarget: "移除私语目标",
    clearWhisperTargets: "清除目标",
    whisperHoldToTalk: "按住私语",
    releaseWhisper: "松开结束私语",
    cancel: "取消",
    saveChanges: "保存更改",
    close: "关闭",
    done: "完成",
    voiceLobby: "语音大厅",
    languageMenu: "语言",
    langSwitch: "English",
  },
  en: {
    themeSystem: "System theme",
    themeLight: "Light theme",
    themeDark: "Dark theme",
    switchToLightTheme: "Switch to light theme",
    switchToDarkTheme: "Switch to dark theme",
    browserWorkspace: "Browser voice workspace",
    secureGateway: "Secure voice gateway",
    adminConsole: "Admin console",
    currentVersion: "Current version",
    viewChangelog: "View changelog",
    notConfigured: "The WebSpeak TeamSpeak target has not been configured.",
    configureNow: "Open admin console",
    privateAudio: "Private community audio",
    joinLine1: "Connect to your server,",
    joinLine2: "start the conversation.",
    joinDescription: "No TeamSpeak client installation required. Open your browser and join a voice channel with low-latency audio built for conversation.",
    highQuality: "High quality audio",
    opusAudio: "Low-latency Opus transport",
    secureJoin: "Secure join",
    inviteProtected: "Invite link protects your server",
    realtime: "Real-time presence",
    membersSync: "Channel members stay in sync",
    privateServer: "Private voice server",
    mainNav: "Main navigation",
    memberVolume: "Member volume",
    joinServer: "JOIN YOUR SERVER",
    welcomeBack: "Welcome back",
    joinLead: "Choose a nickname and the channel to enter.",
    serverAddress: "TeamSpeak server address",
    serverAddressPlaceholder: "e.g. ts.example.com or 127.0.0.1",
    serverPort: "Voice port",
    serverPortPlaceholder: "9987",
    serverAddressHint: "This is the TeamSpeak address and port reached by the gateway, not a direct browser connection.",
    nickname: "Your nickname",
    nicknamePlaceholder: "e.g. Alex Rivera",
    targetChannel: "Target channel",
    optional: "Optional",
    emptyDefault: "Leave empty to use the default channel",
    rememberIdentity: "Remember this TeamSpeak identity on this device",
    rememberIdentityHint: "Stored only on this device and reused on the next connection.",
    rememberIdentityConcurrentWarning: "Only one connection can use this identity in the same browser. Clear this option for a second connection or use another browser.",
    identityOptions: "Device identity options",
    localPersistenceUnavailable: "Persistent browser storage is unavailable; this session will use an ephemeral identity.",
    favoriteServers: "Favorites",
    recentServers: "Recent servers",
    saveFavorite: "Save favorite",
    removeFavorite: "Remove favorite",
    savedFavoriteToast: "Saved to favorites",
    removedFavoriteToast: "Removed from favorites",
    clearLocalData: "Clear local data",
    clearLocalDataConfirm: "Clear this device's identity, favorites, recent servers, and audio preferences?",
    localDataCleared: "Local data cleared",
    connecting: "Connecting…",
    enterVoice: "Enter voice space",
    connectionAuthorized: "Connection details are used only for this voice session",
    githubRepository: "GitHub repository",
    qqGroup: "QQ group",
    qqGroupQrAlt: "QQ group QR code",
    qqJoinDirect: "Or join directly via the group link",
    joinQqGroup: "Join the QQ group",
    bilibiliProfile: "Bilibili profile",
    browserSupport: "Chrome / Edge 94+",
    teamSpeakClient: "TeamSpeak browser client",
    home: "Home",
    activity: "Activity",
    server: "Servers",
    discover: "Discover",
    downloads: "Downloads",
    help: "Help",
    needHelp: "Need help? Contact your server administrator",
    serverOptions: "More server options",
    online: "Online",
    audioSettings: "Audio settings",
    desktopAudioControls: "Audio controls",
    startAccompaniment: "Share accompaniment",
    stopAccompaniment: "Stop accompaniment",
    accompanimentStarted: "Accompaniment sharing started",
    accompanimentStopped: "Accompaniment sharing stopped",
    accompanimentActive: "Accompaniment sharing",
    accompanimentNeedsWebRtc: "Accompaniment requires WebRTC",
    accompanimentNoAudio: "The selected source has no shareable audio. Select it again and enable audio sharing",
    accompanimentPermissionDenied: "Could not access accompaniment audio. Allow screen sharing and enable audio sharing",
    accompanimentUnsupported: "This browser does not support accompaniment sharing",
    serverPassword: "Server password",
    optionalPassword: "Leave blank if not required",
    switchChannel: "Switch channel",
    searchChannels: "Search channels",
    voiceChannels: "Voice channels",
    peopleOnline: "{{count}} online",
    channelPreparing: "Channel list is preparing",
    channelPreparingLead: "Voice still works when the server does not expose a channel directory.",
    reload: "Reload",
    quickActions: "Quick actions",
    inviteFriends: "Invite friends",
    audioAndMic: "Audio & microphone",
    stableConnection: "Stable connection",
    websocket: "WebSocket",
    serverBreadcrumb: "Server",
    copyInvite: "Copy invite link",
    exit: "Exit",
    live: "LIVE",
    voiceSpace: "Voice space",
    roomDescription: "Stay in clear, natural conversation with everyone in this channel.",
    membersOnline: "{{count}} members online",
    encrypted: "Encrypted connection",
    voiceActivity: "VOICE ACTIVITY",
    speakingNow: "Speaking now",
    onlineShort: "{{count}} online",
    you: "You",
    selfSuffix: " (You)",
    connected: "Connected",
    speaking: "Speaking…",
    connectedYou: "Connected · you",
    waitingForMembers: "Waiting for people to join",
    prepareMicrophone: "You can get your microphone ready.",
    moreMembers: "More members",
    viewLeft: "See them on the left",
    textChannel: "TEXT CHANNEL",
    channelChat: "{{channel}} chat",
    messageCount: "{{count}} messages",
    chatStart: "This is the beginning of the chat",
    chatStartLead: "Send a message and say hello to your channel friends.",
    chatTabs: "Chat tabs",
    serverChat: "Server",
    privateMessage: "Private message",
    privateMessagePlaceholder: "Message privately…",
    serverMessagePlaceholder: "Message the server…",
    channelPasswordPrompt: "Enter the channel password",
    privateChatStart: "This is the beginning of the private chat",
    privateChatStartLead: "Send a private message.",
    eventLog: "Event log",
    eventCount: "{{count}} events",
    noEvents: "No server events yet",
    noEventsLead: "Channel and member changes will appear here.",
    available: "Available",
    away: "Away",
    awayPrompt: "Away message (optional)",
    poke: "Poke",
    pokedYou: "poked you",
    pokeMessagePrompt: "Poke message (optional)",
    pokeSent: "Poke sent",
    copyNickname: "Copy nickname",
    copiedNickname: "Nickname copied",
    attachmentUnavailable: "Attachments unavailable",
    emojiUnavailable: "Emoji unavailable",
    sendMessagePlaceholder: "Message the channel…",
    send: "Send",
    muteMic: "Mute mic",
    unmuteMic: "Unmute mic",
    microphoneActive: "Microphone on",
    microphoneMuted: "Microphone off",
    microphoneActiveHint: "When muted, no microphone audio is sent to the server",
    microphoneMutedHint: "Your microphone is muted and other members cannot hear you",
    sending: "Sending",
    exitVoice: "Leave voice",
    people: "People",
    searchMembers: "Search members",
    onlineGroup: "ONLINE — {{count}}",
    yourDevice: "Your device",
    memberOnline: "Online",
    memberStates: "Member states",
    inputMuted: "Microphone muted",
    outputMuted: "Output muted",
    channelCommander: "Channel commander",
    noMatchingMembers: "No matching members",
    noMembersInChannel: "No members in this channel",
    volumeTip: "Drag a member slider to adjust their volume just for you.",
    moreMemberOptions: "More member options",
    connectedToast: "You are connected to this server",
    connectionInterrupted: "Connection interrupted",
    reconnectingAttempt: "Reconnecting… Attempt {{attempt}}",
    reconnectFailed: "Could not restore the connection",
    reconnectNow: "Reconnect now",
    back: "Back",
    volumeToast: "Adjust each member's volume from the list",
    copiedToast: "Invite link copied",
    copyFailedToast: "Copy failed. Copy the browser address manually",
    leftToast: "You left the voice space",
    focusedToast: "This version is focused on the voice workspace",
    settings: "Settings",
    profile: "Profile",
    privacy: "Privacy",
    notifications: "Notifications",
    browserClient: "Browser client",
    audioConfiguration: "Audio configuration",
    inputDevice: "Input device",
    microphone: "Microphone",
    microphoneState: "Microphone state",
    defaultMicrophone: "Default browser microphone",
    microphoneNumber: "Microphone {{index}}",
    speakerNumber: "Speaker {{index}}",
    permission: "Permission",
    permissionUnknown: "Not requested",
    permissionGranted: "Granted",
    permissionDenied: "Denied",
    inputVolume: "Input volume",
    voxThreshold: "Voice activation threshold",
    micLevel: "Mic level",
    microphoneTest: "Microphone test",
    stopTest: "Stop test",
    startTest: "Start test",
    localMicTestHint: "Local test: the recording is played in this browser and never sent to TeamSpeak.",
    silence: "Silence",
    optimal: "Optimal",
    loud: "Loud",
    outputDevice: "Output device",
    speakers: "Speakers / headphones",
    defaultOutput: "Default browser output",
    outputVolume: "Output volume",
    outputDeviceUnsupported: "Output device selection is not supported by this browser. Using the default output device.",
    notificationVolume: "Notification volume",
    audioStatus: "Audio status",
    audioReady: "Audio ready",
    audioSuspended: "Audio paused by the browser",
    audioUnknown: "Not initialized",
    audioPrivacy: "WebSpeak processes audio in the browser's secure context and does not save recordings.",
    mobileNavigation: "Mobile navigation",
    mobileChannels: "Channels",
    mobileChat: "Chat",
    mobileVoice: "Voice",
    mobileMore: "More",
    whisperTargets: "Whisper targets",
    setWhisperTarget: "Set as whisper target",
    removeWhisperTarget: "Remove whisper target",
    clearWhisperTargets: "Clear targets",
    whisperHoldToTalk: "Hold to whisper",
    releaseWhisper: "Release to stop whispering",
    cancel: "Cancel",
    saveChanges: "Save changes",
    close: "Close",
    done: "Done",
    voiceLobby: "Voice lobby",
    languageMenu: "Language",
    langSwitch: "中文",
  },
};

translations.de = {
  ...translations.en,
  themeSystem: "Systemdesign",
  themeLight: "Helles Design",
  themeDark: "Dunkles Design",
  switchToLightTheme: "Zum hellen Design wechseln",
  switchToDarkTheme: "Zum dunklen Design wechseln",
  browserWorkspace: "Sprachbereich im Browser",
  secureGateway: "Sicheres Sprach-Gateway",
  adminConsole: "Administrationskonsole",
  currentVersion: "Aktuelle Version",
  viewChangelog: "Änderungsprotokoll ansehen",
  notConfigured: "Das TeamSpeak-Ziel von WebSpeak wurde noch nicht konfiguriert.",
  configureNow: "Administrationskonsole öffnen",
  privateAudio: "Private Community-Sprachumgebung",
  joinLine1: "Verbinde dich mit deinem Server,",
  joinLine2: "und beginne das Gespräch.",
  joinDescription: "Keine Installation des TeamSpeak-Clients nötig. Öffne den Browser und tritt einem Sprachkanal bei – leichtgewichtig und mit geringer Latenz.",
  highQuality: "Hochwertige Sprache",
  opusAudio: "Opus-Übertragung mit geringer Latenz",
  secureJoin: "Sicher beitreten",
  inviteProtected: "Einladungslink schützt deinen Server",
  realtime: "Präsenz in Echtzeit",
  membersSync: "Kanalmitglieder bleiben synchron",
  privateServer: "Privater Sprachserver",
  mainNav: "Hauptnavigation",
  memberVolume: "Mitgliedslautstärke",
  joinServer: "DEINEM SERVER BEITRETEN",
  welcomeBack: "Willkommen zurück",
  joinLead: "Wähle einen Namen und den Kanal, dem du beitreten möchtest.",
  serverAddress: "TeamSpeak-Serveradresse",
  serverAddressPlaceholder: "z. B. ts.example.com oder 127.0.0.1",
  serverPort: "Sprachport",
  serverPortPlaceholder: "9987",
  serverAddressHint: "Dies ist die TeamSpeak-Adresse und der Port, die vom Gateway erreicht werden – keine direkte Browseradresse.",
  nickname: "Dein Name",
  nicknamePlaceholder: "z. B. Alex Rivera",
  targetChannel: "Zielkanal",
  optional: "Optional",
  emptyDefault: "Leer lassen, um den Standardkanal zu verwenden",
  rememberIdentity: "Diese TeamSpeak-Identität auf diesem Gerät speichern",
  rememberIdentityHint: "Wird nur auf diesem Gerät gespeichert und bei der nächsten Verbindung wiederverwendet.",
  rememberIdentityConcurrentWarning: "Dieselbe Identität kann in einem Browser nur eine Verbindung gleichzeitig verwenden. Deaktiviere die Option für eine zweite Verbindung oder nutze einen anderen Browser.",
  identityOptions: "Identitätsoptionen des Geräts",
  localPersistenceUnavailable: "Dauerhafter Browserspeicher ist nicht verfügbar; diese Sitzung verwendet eine temporäre Identität.",
  favoriteServers: "Favoriten",
  recentServers: "Zuletzt verwendet",
  saveFavorite: "Als Favorit speichern",
  removeFavorite: "Aus Favoriten entfernen",
  savedFavoriteToast: "Als Favorit gespeichert",
  removedFavoriteToast: "Aus Favoriten entfernt",
  clearLocalData: "Lokale Daten löschen",
  clearLocalDataConfirm: "Identität, Favoriten, letzte Verbindungen und Audioeinstellungen dieses Geräts löschen?",
  localDataCleared: "Lokale Daten gelöscht",
  connecting: "Verbindung wird hergestellt…",
  enterVoice: "Sprachbereich betreten",
  connectionAuthorized: "Verbindungsdaten werden nur für diese Sprachsitzung verwendet",
  githubRepository: "GitHub-Repository",
  qqGroup: "QQ-Gruppe",
  qqGroupQrAlt: "QR-Code der QQ-Gruppe",
  qqJoinDirect: "Oder direkt über den Gruppenlink beitreten",
  joinQqGroup: "QQ-Gruppe beitreten",
  bilibiliProfile: "Bilibili-Profil",
  browserSupport: "Chrome / Edge 94+",
  teamSpeakClient: "TeamSpeak-Browserclient",
  home: "Startseite",
  activity: "Aktivität",
  server: "Server",
  discover: "Entdecken",
  downloads: "Downloads",
  help: "Hilfe",
  needHelp: "Brauchst du Hilfe? Wende dich an den Serveradministrator.",
  serverOptions: "Weitere Serveroptionen",
  online: "Online",
  audioSettings: "Audioeinstellungen",
  desktopAudioControls: "Audiosteuerung",
  startAccompaniment: "Begleitung teilen",
  stopAccompaniment: "Begleitung stoppen",
  accompanimentStarted: "Begleitung wird geteilt",
  accompanimentStopped: "Begleitung beendet",
  accompanimentActive: "Begleitung aktiv",
  accompanimentNeedsWebRtc: "Die Begleitungsfunktion benötigt WebRTC.",
  accompanimentNoAudio: "Die ausgewählte Quelle enthält kein teilbares Audio. Wähle sie erneut und aktiviere die Audiofreigabe.",
  accompanimentPermissionDenied: "Begleitungs-Audio konnte nicht abgerufen werden. Erlaube die Bildschirmfreigabe und aktiviere die Audiofreigabe.",
  accompanimentUnsupported: "Dieser Browser unterstützt das Teilen von Begleitung nicht.",
  serverPassword: "Serverpasswort",
  optionalPassword: "Leer lassen, wenn kein Passwort erforderlich ist",
  switchChannel: "Kanal wechseln",
  searchChannels: "Kanäle suchen",
  voiceChannels: "Sprachkanäle",
  peopleOnline: "{{count}} online",
  channelPreparing: "Kanalliste wird vorbereitet",
  channelPreparingLead: "Auch ohne Kanalliste des Servers funktioniert die Sprachverbindung.",
  reload: "Neu laden",
  quickActions: "Schnellaktionen",
  inviteFriends: "Freunde einladen",
  audioAndMic: "Audio und Mikrofon",
  stableConnection: "Stabile Verbindung",
  websocket: "WebSocket",
  serverBreadcrumb: "Server",
  copyInvite: "Einladungslink kopieren",
  exit: "Beenden",
  live: "LIVE",
  voiceSpace: "Sprachbereich",
  roomDescription: "Bleibe mit allen Mitgliedern dieses Kanals klar und natürlich im Gespräch.",
  membersOnline: "{{count}} Mitglieder online",
  encrypted: "Verschlüsselte Verbindung",
  voiceActivity: "SPRACHAKTIVITÄT",
  speakingNow: "Spricht gerade",
  onlineShort: "{{count}} online",
  you: "Du",
  selfSuffix: " (Du)",
  connected: "Verbunden",
  speaking: "Spricht…",
  connectedYou: "Verbunden · du",
  waitingForMembers: "Warte auf weitere Mitglieder",
  prepareMicrophone: "Du kannst dein Mikrofon hier vorbereiten.",
  moreMembers: "Weitere Mitglieder",
  viewLeft: "Links anzeigen",
  textChannel: "TEXTKANAL",
  channelChat: "Chat in {{channel}}",
  messageCount: "{{count}} Nachrichten",
  chatStart: "Dies ist der Anfang des Chats",
  chatStartLead: "Sende eine Nachricht und begrüße deine Kanalmitglieder.",
  chatTabs: "Chat-Tabs",
  serverChat: "Server",
  privateMessage: "Private Nachricht",
  privateMessagePlaceholder: "Private Nachricht senden…",
  serverMessagePlaceholder: "Nachricht an den Server senden…",
  channelPasswordPrompt: "Kanalpasswort eingeben",
  privateChatStart: "Dies ist der Anfang des privaten Chats",
  privateChatStartLead: "Sende eine private Nachricht.",
  eventLog: "Ereignisprotokoll",
  eventCount: "{{count}} Ereignisse",
  noEvents: "Noch keine Serverereignisse",
  noEventsLead: "Änderungen an Kanälen und Mitgliedern werden hier angezeigt.",
  available: "Verfügbar",
  away: "Abwesend",
  awayPrompt: "Abwesenheitsnachricht (optional)",
  poke: "Anstupsen",
  pokedYou: "hat dich angestupst",
  pokeMessagePrompt: "Anstupsnachricht (optional)",
  pokeSent: "Anstupser gesendet",
  copyNickname: "Namen kopieren",
  copiedNickname: "Name kopiert",
  attachmentUnavailable: "Anhänge nicht verfügbar",
  emojiUnavailable: "Emojis nicht verfügbar",
  sendMessagePlaceholder: "Nachricht an die Kanalmitglieder…",
  send: "Senden",
  muteMic: "Mikrofon stummschalten",
  unmuteMic: "Mikrofon einschalten",
  microphoneActive: "Mikrofon eingeschaltet",
  microphoneMuted: "Mikrofon ausgeschaltet",
  microphoneActiveHint: "Bei ausgeschaltetem Mikrofon wird kein Mikrofonton an den Server gesendet.",
  microphoneMutedHint: "Dein Mikrofon ist ausgeschaltet; andere Mitglieder können dich nicht hören.",
  sending: "Wird gesendet",
  exitVoice: "Sprachbereich verlassen",
  people: "Mitglieder",
  searchMembers: "Mitglieder suchen",
  onlineGroup: "Online — {{count}}",
  yourDevice: "Dein Gerät",
  memberOnline: "Online",
  memberStates: "Mitgliederstatus",
  inputMuted: "Mikrofon deaktiviert",
  outputMuted: "Lautsprecher deaktiviert",
  channelCommander: "Kanaladministrator",
  noMatchingMembers: "Keine passenden Mitglieder gefunden",
  noMembersInChannel: "Keine Mitglieder in diesem Kanal",
  volumeTip: "Ziehe den Regler rechts neben einem Mitglied, um dessen Lautstärke einzeln anzupassen.",
  moreMemberOptions: "Weitere Mitgliederoptionen",
  connectedToast: "Mit diesem Server verbunden",
  connectionInterrupted: "Verbindung unterbrochen, Wiederherstellung wird versucht…",
  reconnectingAttempt: "Verbindungsversuch {{attempt}}",
  reconnectFailed: "Verbindung konnte nicht wiederhergestellt werden",
  reconnectNow: "Jetzt neu verbinden",
  back: "Zurück",
  volumeToast: "Die Lautstärke jedes Mitglieds kann separat angepasst werden.",
  copiedToast: "Einladungslink kopiert",
  copyFailedToast: "Kopieren fehlgeschlagen. Kopiere die Browseradresse manuell.",
  leftToast: "Sprachbereich sicher verlassen",
  focusedToast: "Diese Version konzentriert sich auf den Sprachbereich.",
  settings: "Einstellungen",
  profile: "Profil",
  privacy: "Datenschutz",
  notifications: "Benachrichtigungen",
  browserClient: "Browserclient",
  audioConfiguration: "Audiokonfiguration",
  inputDevice: "Eingabegerät",
  microphone: "Mikrofon",
  microphoneState: "Mikrofonstatus",
  defaultMicrophone: "Standardmikrofon des Browsers",
  microphoneNumber: "Mikrofon {{index}}",
  speakerNumber: "Lautsprecher {{index}}",
  permission: "Berechtigung",
  permissionUnknown: "Noch nicht angefragt",
  permissionGranted: "Erlaubt",
  permissionDenied: "Abgelehnt",
  inputVolume: "Eingangslautstärke",
  voxThreshold: "Sprachaktivierungsschwelle",
  micLevel: "Mikrofonlautstärke",
  microphoneTest: "Mikrofontest",
  stopTest: "Test stoppen",
  startTest: "Test starten",
  localMicTestHint: "Lokaler Test: Die Aufnahme wird nur im Browser wiedergegeben und nicht an TeamSpeak gesendet.",
  silence: "Ruhig",
  optimal: "Optimal",
  loud: "Laut",
  outputDevice: "Ausgabegerät",
  speakers: "Lautsprecher / Kopfhörer",
  defaultOutput: "Standardausgabe des Browsers",
  outputVolume: "Ausgabelautstärke",
  outputDeviceUnsupported: "Dieser Browser unterstützt keine Auswahl des Ausgabegeräts. Die Standardausgabe wird verwendet.",
  notificationVolume: "Benachrichtigungslautstärke",
  audioStatus: "Audiostatus",
  audioReady: "Audio bereit",
  audioSuspended: "Audio wurde vom Browser pausiert",
  audioUnknown: "Nicht initialisiert",
  audioPrivacy: "WebSpeak verarbeitet Audio im sicheren Browserkontext und speichert keine Aufnahmen.",
  mobileNavigation: "Mobile Navigation",
  mobileChannels: "Kanäle",
  mobileChat: "Chat",
  mobileVoice: "Sprache",
  mobileMore: "Mehr",
  whisperTargets: "Flüsterziele",
  setWhisperTarget: "Als Flüsterziel festlegen",
  removeWhisperTarget: "Flüsterziel entfernen",
  clearWhisperTargets: "Ziele löschen",
  whisperHoldToTalk: "Zum Flüstern gedrückt halten",
  releaseWhisper: "Loslassen, um das Flüstern zu beenden",
  cancel: "Abbrechen",
  saveChanges: "Änderungen speichern",
  close: "Schließen",
  done: "Fertig",
  voiceLobby: "Sprachlobby",
  languageMenu: "Sprache",
  langSwitch: "中文",
};

function initialServerTarget() {
  const explicit = query.get("server") ?? query.get("target");
  if (explicit?.trim()) return splitTeamSpeakTarget(explicit);
  const host = (query.get("tsHost") ?? location.hostname).trim();
  const port = (query.get("tsPort") ?? DEFAULT_TEAM_SPEAK_PORT).trim();
  return splitTeamSpeakTarget(host, port || DEFAULT_TEAM_SPEAK_PORT);
}

function getInitialLanguage(): Language {
  const stored = localStorage.getItem("webspeak:language");
  if (stored === "zh" || stored === "en" || stored === "de") return stored;
  if (typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("zh")) return "zh";
  if (typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("de")) return "de";
  return "en";
}

function t(key: string, variables: Record<string, string | number> = {}) {
  let value = translations[language.value][key] ?? translations.en[key] ?? translations.zh[key] ?? key;
  for (const [name, replacement] of Object.entries(variables)) value = value.replaceAll(`{{${name}}}`, String(replacement));
  return value;
}

function localizedMessage(message: string) {
  if (language.value === "zh") return message;
  const exact: Record<string, string> = {
    "语音功能需要 HTTPS 安全连接": "Voice requires a secure HTTPS connection",
    "当前浏览器不支持麦克风访问": "This browser does not support microphone access",
    "当前浏览器不支持 Web Audio 音频处理": "This browser does not support Web Audio processing",
    "当前浏览器不支持音频解码，请使用最新版 Chrome 或 Edge": "Audio decoding is unavailable. Use the latest Chrome or Edge",
    "当前浏览器不支持扬声器设备选择，将使用默认输出设备": "Output device selection is not supported by this browser. Using the default output device",
    "所选扬声器当前不可用": "The selected speaker is not available",
    "连接服务器失败，请检查邀请链接或服务器状态": "Could not connect. Check the invite link or server status",
    "TeamSpeak 连接已断开": "The TeamSpeak connection was closed",
    "连接已断开": "The connection was closed",
    "此 TeamSpeak 身份已在另一个浏览器页面使用，请关闭另一条连接或取消“保持身份”后重试": "This TeamSpeak identity is already used by another browser page. Close that connection or clear ‘Remember identity’ and try again",
    "TeamSpeak 服务器地址无效": "The TeamSpeak server address is invalid",
    "TeamSpeak 服务器连接失败": "Could not connect to the TeamSpeak server",
    "服务器当前已满，请稍后重试": "The server is full. Try again shortly",
    "WebSpeak 尚未配置 TeamSpeak 目标。": "The WebSpeak TeamSpeak target has not been configured",
    "此 TeamSpeak 服务器地址不允许连接": "This TeamSpeak server address is not allowed",
    "请输入有效的昵称": "Enter a valid nickname",
    "消息格式无效": "The message format is invalid",
    "请求标识无效": "The request id is invalid",
    "不支持的操作": "This operation is not supported",
    "操作参数无效": "The operation payload is invalid",
    "频道标识无效": "The channel id is invalid",
    "成员标识无效": "The member id is invalid",
    "频道密码无效": "The channel password is invalid",
    "文字消息无效": "The text message is invalid",
    "戳一戳消息无效": "The poke message is invalid",
    "离开状态无效": "The away status is invalid",
    "音频帧格式无效": "The audio frame is invalid",
    "私语目标无效": "The whisper targets are invalid",
    "私语状态无效": "The whisper state is invalid",
    "请先选择私语目标": "Choose a whisper target first",
    "私语目标已离线": "A whisper target is offline",
    "TeamSpeak 会话尚未就绪": "The TeamSpeak session is not ready",
    "频道切换失败": "Channel switch failed",
    "该频道需要密码": "This channel requires a password",
    "该频道已满": "This channel is full",
    "你没有执行此操作的权限": "You do not have permission to perform this action",
    "成员已离线": "This member is offline",
    "操作失败": "The operation failed",
  };
  if (exact[message]) return exact[message];
  if (message.startsWith("麦克风访问失败：")) return `Microphone access failed: ${message.slice(8)}`;
  if (message.startsWith("切换失败：")) return `Channel switch failed: ${message.slice(5)}`;
  return message;
}

function persistLanguage() {
  localStorage.setItem("webspeak:language", language.value);
  void saveLocalPreferences({ schemaVersion: 1, language: language.value });
}

function cycleTheme() {
  themeMode.value = nextTheme(themeMode.value);
  saveTheme(themeMode.value);
  void saveLocalPreferences({ schemaVersion: 1, theme: themeMode.value });
}

const heroBars = [12, 24, 18, 35, 18, 28, 42, 23, 50, 34, 19, 28, 39, 22, 46, 25, 17, 31, 14];

const channelTree = computed<TreeChannel[]>(() => {
  const source = [...channels];
  const byId = new Map(source.map((item) => [item.id, item]));
  const depthCache = new Map<string, number>();

  function depthOf(item: ChannelInfo, visiting = new Set<string>()): number {
    if (depthCache.has(item.id)) return depthCache.get(item.id)!;
    if (!item.parentID || item.parentID === "0" || visiting.has(item.id)) return 0;
    const parent = byId.get(item.parentID);
    const depth = parent ? depthOf(parent, new Set(visiting).add(item.id)) + 1 : 0;
    depthCache.set(item.id, depth);
    return depth;
  }

  return source
    .map((item) => ({
      ...item,
      depth: depthOf(item),
      members: (item.members ?? []).map((member) => ({ ...member, isSelf: member.id === voiceState.tsClientId })),
    }))
    .sort((a, b) => `${a.parentID}/${a.id}`.localeCompare(`${b.parentID}/${b.id}`));
});

const currentChannel = computed<TreeChannel | undefined>(() => {
  const explicitlySelected = channelTree.value.find((item) => item.id === selectedChannelId.value);
  if (explicitlySelected) return explicitlySelected;
  const fromSelf = channelTree.value.find((item) => item.members.some((member) => member.id === voiceState.tsClientId));
  if (fromSelf) return fromSelf;
  return channelTree.value.find((item) => item.name === channel.value) ?? channelTree.value[0];
});
const currentChannelName = computed(() => (currentChannel.value?.name ?? channel.value) || t("voiceLobby"));
const currentChannelDescription = computed(() => currentChannel.value?.description ?? "");
const currentMembers = computed<ChannelMember[]>(() => {
  const source = currentChannel.value ? currentChannel.value.members : members;
  return source.map((member) => ({ ...member, isSelf: member.isSelf || member.id === voiceState.tsClientId }));
});
const roomMembers = computed(() => currentMembers.value.slice(0, 4));
const memberChannels = computed<TreeChannel[]>(() => {
  if (channelTree.value.length) return channelTree.value;
  return [{ id: "__current__", parentID: "0", name: currentChannelName.value, description: currentChannelDescription.value, members: currentMembers.value, depth: 0 }];
});
const filteredMemberChannels = computed(() => {
  const search = memberQuery.value.trim().toLowerCase();
  if (!search) return memberChannels.value;
  return memberChannels.value.filter((item) => item.name.toLowerCase().includes(search) || item.members.some((member) => member.nickname.toLowerCase().includes(search)));
});
const whisperTargets = computed(() => [...whisperTargetIds].map((id) => members.find((member) => member.id === id)).filter((member): member is ChannelMember => Boolean(member)));

const privateConversations = computed(() => {
  const conversations = new Map<string, { id: number; name: string; lastMessage: number }>();
  for (const message of chatMessages) {
    if (message.scope !== "private" || !message.conversationId) continue;
    const id = Number(message.conversationId);
    if (!id) continue;
    const member = members.find((candidate) => candidate.id === id);
    const existing = conversations.get(message.conversationId);
    conversations.set(message.conversationId, { id, name: member?.nickname ?? existing?.name ?? message.invokerName, lastMessage: Math.max(existing?.lastMessage ?? 0, message.timestamp) });
  }
  return [...conversations.values()].sort((a, b) => b.lastMessage - a.lastMessage);
});

const visibleChatMessages = computed(() => {
  if (chatTab.value === "server") return chatMessages.filter((message) => message.scope === "server");
  if (chatTab.value === "private") return chatMessages.filter((message) => message.scope === "private" && message.conversationId === String(privateClientId.value));
  if (chatTab.value !== "channel") return [];
  const channelId = currentChannel.value?.id;
  return chatMessages.filter((message) => message.scope === "channel" && (!message.targetId || message.targetId === "0" || !channelId || message.targetId === channelId));
});

const chatTabLabel = computed(() => chatTab.value === "channel" ? t("textChannel") : chatTab.value === "server" ? t("serverChat") : chatTab.value === "private" ? t("privateMessage") : t("eventLog"));
const chatTitle = computed(() => chatTab.value === "channel" ? t("channelChat", { channel: currentChannelName.value }) : chatTab.value === "server" ? t("serverChat") : chatTab.value === "events" ? t("eventLog") : privateConversations.value.find((conversation) => conversation.id === privateClientId.value)?.name ?? t("privateMessage"));
const chatPlaceholder = computed(() => chatTab.value === "private" ? t("privateMessagePlaceholder") : chatTab.value === "server" ? t("serverMessagePlaceholder") : t("sendMessagePlaceholder"));
const visiblePokes = computed(() => pokeNotifications.slice(-3));
const memberMenuStyle = computed(() => memberMenu.value ? { left: `${memberMenu.value.x}px`, top: `${memberMenu.value.y}px` } : {});

watch(channelTree, (list) => {
  if (!selectedChannelId.value && list[0]) {
    selectedChannelId.value = list.find((item) => item.name === channel.value)?.id
      ?? list.find((item) => item.members.some((member) => member.id === voiceState.tsClientId))?.id
      ?? "";
  }
}, { deep: true });
watch([() => chatMessages.length, chatTab, privateClientId], () => nextTick(scrollChatToEnd));
watch(() => chatMessages.length, (length, previousLength) => {
  const latest = chatMessages[length - 1];
  if (latest && length > previousLength && latest.scope === "private" && !latest.isSelf) playNotification("private");
});
watch(() => voiceState.errorCode, (code) => {
  if (code !== "CHANNEL_PASSWORD_REQUIRED" || !selectedChannelId.value) return;
  const password = window.prompt(t("channelPasswordPrompt"), "");
  if (password !== null) switchChannel(selectedChannelId.value, password);
});
watch(() => pokeNotifications.length, (length, previousLength) => {
  const latest = pokeNotifications[length - 1];
  if (!latest || length <= previousLength) return;
  showToast(`${latest.invokerName} ${t("pokedYou")}${latest.message ? `：${latest.message}` : ""}`);
  playNotification("poke");
  if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(t("poke"), { body: `${latest.invokerName}: ${latest.message || t("pokedYou")}` });
});
watch(settingsOpen, (open) => {
  if (open) {
    audioSettingsError.value = "";
    prepareInputDevices().catch((error: unknown) => {
      audioSettingsError.value = microphoneErrorMessage(error);
    });
  } else {
    stopMicrophoneTest();
  }
});
watch(rememberIdentity, (remember) => {
  localStorage.setItem("webspeak:remember-identity", remember ? "1" : "0");
  if (!remember) {
    identityMaterial.value = "";
    void removeStoredIdentity();
  }
});
watch([rememberIdentity, identityMaterial], ([remember, material]) => {
  if (remember && material) void saveStoredIdentity(material);
  if (!remember && material) identityMaterial.value = "";
});
watch(() => voiceState.connected, (connected) => {
  if (!connected) return;
  playNotification("connected");
  const address = currentServerTarget();
  if (!address) return;
  const recent: RecentServer = {
    id: serverKey(address),
    address,
    ...(nickname.value.trim() ? { nickname: nickname.value.trim() } : {}),
    ...(rememberIdentity.value && identityMaterial.value ? { identityId: "current" } : {}),
    lastConnectedAt: Date.now(),
    ...(channel.value.trim() ? { lastChannelHint: { name: channel.value.trim() } } : {}),
  };
  void recordRecentServer(recent).then(() => listRecentServers().then((items) => { recentServers.value = items; }));
});
watch(() => voiceState.reconnecting, (reconnecting, wasReconnecting) => {
  if (reconnecting && !wasReconnecting) {
    playNotification("disconnected");
  }
});
watch(() => voiceState.reconnectFailed, (failed, wasFailed) => {
  if (failed && !wasFailed) playNotification("reconnectFailed");
});

let deviceChangeHandler: (() => void) | undefined;
let viewportMediaQuery: MediaQueryList | undefined;
let viewportChangeHandler: (() => void) | undefined;

onMounted(() => {
  browserError.value = checkSupport() ?? "";
  void loadPublicConfig();
  void loadLocalPreferences().then((preferences) => {
    if (!localStorage.getItem("webspeak:language") && (preferences.language === "zh" || preferences.language === "en" || preferences.language === "de")) language.value = preferences.language;
    if (!localStorage.getItem("webspeak:theme") && (preferences.theme === "system" || preferences.theme === "light" || preferences.theme === "dark")) {
      themeMode.value = preferences.theme;
      applyTheme(themeMode.value);
    }
  });
  void loadStoredIdentity().then((stored) => {
    if (stored && localStorage.getItem("webspeak:remember-identity") === "1") {
      identityMaterial.value = stored.privateMaterial;
      rememberIdentity.value = true;
    }
  }).finally(() => {
    identityReady.value = true;
  });
  void listFavorites().then((items) => { favoriteServers.value = items; });
  void listRecentServers().then((items) => { recentServers.value = items; });
  deviceChangeHandler = () => { void refreshAudioDevices().catch(() => undefined); };
  navigator.mediaDevices?.addEventListener("devicechange", deviceChangeHandler);
  viewportMediaQuery = window.matchMedia("(max-width: 740px)");
  viewportChangeHandler = () => {
    isMobileViewport.value = viewportMediaQuery?.matches ?? false;
    if (!isMobileViewport.value) memberMenu.value = null;
    else if (accompanimentActive.value) void stopAccompaniment();
  };
  viewportChangeHandler();
  viewportMediaQuery.addEventListener?.("change", viewportChangeHandler);
});
onUnmounted(() => {
  disconnect();
  if (deviceChangeHandler) navigator.mediaDevices?.removeEventListener("devicechange", deviceChangeHandler);
  if (viewportMediaQuery && viewportChangeHandler) viewportMediaQuery.removeEventListener?.("change", viewportChangeHandler);
  if (toastTimer) clearTimeout(toastTimer);
});

function doConnect() {
  if (!canJoin.value || voiceState.connecting) return;
  clearError();
  nickname.value = nickname.value.trim();
  localStorage.setItem("webspeak:nickname", nickname.value);
  void saveLocalPreferences({ schemaVersion: 1, lastNickname: nickname.value });
  if (accessMode.value === "open") {
    serverHost.value = serverHost.value.trim();
    serverPort.value = serverPort.value.trim();
  }
  selectedChannelId.value = "";
  connect(currentServerTarget(), channel.value.trim(), nickname.value, accessMode.value === "open" ? serverPassword.value : "", rememberIdentity.value ? identityMaterial.value : "", rememberIdentity.value, inviteToken);
}

function doDisconnect() {
  disconnect();
  selectedChannelId.value = "";
  showToast(t("leftToast"));
}

function selectChannel(item: TreeChannel) {
  selectedChannelId.value = item.id;
  channel.value = item.name;
  chatTab.value = "channel";
  switchChannel(item.id);
}

function selectChannelById() {
  const item = channelTree.value.find((candidate) => candidate.id === selectedChannelId.value);
  if (item) selectChannel(item);
}

function channelLabel(item: TreeChannel) {
  return `${"　".repeat(item.depth)}${item.name}`;
}

function doShare() {
  const invite = new URL(location.href);
  invite.searchParams.delete("token");
  invite.searchParams.delete("target");
  invite.searchParams.delete("tsHost");
  invite.searchParams.delete("tsPort");
  invite.searchParams.delete("server");
  if (accessMode.value === "open" && serverHost.value.trim()) invite.searchParams.set("server", currentServerTarget());
  if (channel.value) invite.searchParams.set("channel", channel.value);
  navigator.clipboard?.writeText(invite.toString()).then(() => showToast(t("copiedToast")), () => showToast(t("copyFailedToast")));
}

const canJoin = computed(() => Boolean(
  initialized.value
  && nickname.value.trim()
  && (accessMode.value === "fixed" || (serverHost.value.trim() && isValidTeamSpeakPort(serverPort.value))),
));
const isFavorite = computed(() => favoriteServers.value.some((favorite) => favorite.id === serverKey(currentServerTarget())));

function currentServerTarget(): string {
  return combineTeamSpeakTarget(serverHost.value, serverPort.value);
}

function serverKey(address: string): string {
  return address.trim().toLocaleLowerCase();
}

function selectLocalServer(address: string, savedNickname?: string): void {
  const target = splitTeamSpeakTarget(address);
  serverHost.value = target.address;
  serverPort.value = target.port;
  if (savedNickname && !nickname.value.trim()) nickname.value = savedNickname;
}

async function toggleFavorite(): Promise<void> {
  const address = currentServerTarget();
  if (!address) return;
  const id = serverKey(address);
  const existing = favoriteServers.value.find((favorite) => favorite.id === id);
  if (existing) {
    await removeFavorite(id);
    favoriteServers.value = favoriteServers.value.filter((favorite) => favorite.id !== id);
    showToast(t("removedFavoriteToast"));
    return;
  }
  const favorite: FavoriteServer = { id, label: address, address, ...(nickname.value.trim() ? { nickname: nickname.value.trim() } : {}), ...(rememberIdentity.value && identityMaterial.value ? { identityId: "current" } : {}), ...(channel.value.trim() ? { lastChannelHint: { name: channel.value.trim() } } : {}) };
  await saveFavorite(favorite);
  favoriteServers.value = [...favoriteServers.value, favorite].sort((a, b) => a.label.localeCompare(b.label));
  showToast(t("savedFavoriteToast"));
}

async function clearBrowserData(): Promise<void> {
  if (!window.confirm(t("clearLocalDataConfirm"))) return;
  await clearStoredLocalData();
  for (const key of ["webspeak:nickname", "webspeak:language", "webspeak:theme", "webspeak:input-device", "webspeak:output-device", "webspeak:remember-identity"]) localStorage.removeItem(key);
  themeMode.value = "system";
  applyTheme(themeMode.value);
  identityMaterial.value = "";
  rememberIdentity.value = false;
  favoriteServers.value = [];
  recentServers.value = [];
  showToast(t("localDataCleared"));
}

async function loadPublicConfig() {
  try {
    const response = await fetch("/api/public-config", { headers: { accept: "application/json" } });
    if (!response.ok) return;
    const config = await response.json() as { version?: unknown; initialized?: unknown; siteName?: unknown; welcomeText?: unknown; welcomeTextEn?: unknown; accessMode?: unknown; target?: unknown };
    if (typeof config.version === "string" && config.version.trim()) appVersion.value = config.version.trim();
    initialized.value = config.initialized === true;
    if (typeof config.siteName === "string" && config.siteName.trim()) siteName.value = config.siteName.trim();
    if (typeof config.welcomeText === "string") welcomeTextZh.value = config.welcomeText;
    if (typeof config.welcomeTextEn === "string") welcomeTextEn.value = config.welcomeTextEn;
    accessMode.value = config.accessMode === "open" ? "open" : "fixed";
    const hasInviteTarget = query.has("server") || query.has("target") || query.has("tsHost") || query.has("tsPort");
    if (!hasInviteTarget && typeof config.target === "string" && config.target.trim()) {
      const target = splitTeamSpeakTarget(config.target);
      serverHost.value = target.address;
      serverPort.value = target.port;
    }
  } catch {
    // Keep joining disabled until the gateway can confirm its initialized policy.
  } finally {
    serverConfigLoading.value = false;
  }
}

function submitMessage() {
  if (!messageDraft.value.trim()) return;
  if (chatTab.value === "channel") sendTextMessage(messageDraft.value, currentChannel.value?.id ?? selectedChannelId.value);
  else if (chatTab.value === "server") sendServerMessage(messageDraft.value);
  else if (chatTab.value === "private" && privateClientId.value) sendPrivateMessage(privateClientId.value, messageDraft.value, String(privateClientId.value));
  messageDraft.value = "";
}

function openPrivateChat(clientId: number): void {
  if (!clientId || clientId === voiceState.tsClientId) return;
  privateClientId.value = clientId;
  chatTab.value = "private";
  if (isMobileViewport.value) mobileSection.value = "chat";
  memberMenu.value = null;
  nextTick(scrollChatToEnd);
}

function openMemberMenu(member: ChannelMember, event: Event): void {
  if (member.isSelf) return;
  const point = event instanceof MouseEvent ? event : undefined;
  memberMenu.value = { member, x: Math.min((point?.clientX ?? 20), Math.max(12, window.innerWidth - 210)), y: Math.min((point?.clientY ?? 20), Math.max(12, window.innerHeight - 170)) };
}

function openMemberActions(member: ChannelMember): void {
  if (member.isSelf) return;
  memberMenu.value = { member, x: 0, y: 0 };
}

function toggleWhisperTarget(member: ChannelMember): void {
  if (member.isSelf) return;
  const targets = new Set(whisperTargetIds);
  if (targets.has(member.id)) targets.delete(member.id);
  else if (targets.size < 8) targets.add(member.id);
  setWhisperTargets([...targets]);
  showToast(targets.has(member.id) ? t("setWhisperTarget") : t("removeWhisperTarget"));
}

function clearWhisperTargets(): void {
  stopWhisperTalk();
  setWhisperTargets([]);
}

function pokeMember(member: ChannelMember): void {
  sendPoke(member.id, window.prompt(t("pokeMessagePrompt"), "") ?? "");
  showToast(t("pokeSent"));
}

function copyMemberName(member: ChannelMember): void {
  navigator.clipboard?.writeText(member.nickname).then(() => showToast(t("copiedNickname")), () => showToast(t("copyFailedToast")));
}

function toggleAway(): void {
  away.value = !away.value;
  awayMessage.value = away.value ? (window.prompt(t("awayPrompt"), awayMessage.value) ?? "") : "";
  setAway(away.value, awayMessage.value);
}

function dismissPoke(id: string): void {
  const index = pokeNotifications.findIndex((poke) => poke.id === id);
  if (index >= 0) pokeNotifications.splice(index, 1);
}

function scrollChatToEnd() {
  const list = chatListEl.value;
  if (list) list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
}

function showToast(message: string) {
  toast.value = message;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ""; }, 2800);
}

function avatarInitial(name: string) {
  return (name.trim()[0] || "?").toUpperCase();
}

const avatarColors = ["#9edbd4", "#b9d4c5", "#e8c6a8", "#c5c7e8", "#edd2d4", "#c8d9e9", "#e4d3b8"];
function avatarStyle(name: string, isSelf = false) {
  if (isSelf) return { background: "linear-gradient(135deg, #006a64, #2e9f96)" };
  let hash = 0;
  for (let index = 0; index < name.length; index++) hash = name.charCodeAt(index) + ((hash << 5) - hash);
  return { background: avatarColors[Math.abs(hash) % avatarColors.length] };
}

function isSpeaking(member: ChannelMember) {
  return speakingIds.has(member.id);
}

function memberDisplayName(member: ChannelMember): string {
  return member.isSelf ? `${member.nickname}${t("selfSuffix")}` : member.nickname;
}

function formatTime(timestamp: number) {
  const locale = language.value === "zh" ? "zh-CN" : language.value === "de" ? "de-DE" : "en-US";
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

function rangeStyle(value: number, max: number) {
  const percent = Math.max(0, Math.min(100, (value / max) * 100));
  return { background: `linear-gradient(to right, #006a64 0%, #006a64 ${percent}%, #e7eceb ${percent}%, #e7eceb 100%)` };
}

function onVolInput(clientId: number, event: Event) {
  setVolume(clientId, Number((event.target as HTMLInputElement).value) / 100);
}

function onInputVolume(event: Event) {
  setInputVolume(Number((event.target as HTMLInputElement).value) / 100);
}

function onOutputVolume(event: Event) {
  setOutputVolume(Number((event.target as HTMLInputElement).value) / 100);
}

function onVoxThreshold(event: Event) {
  setVoxThreshold(Number((event.target as HTMLInputElement).value) / 1000);
}

function onNotificationVolume(event: Event) {
  setNotificationVolume(Number((event.target as HTMLInputElement).value) / 100);
}

async function onInputDeviceChange(event: Event) {
  audioSettingsError.value = "";
  try {
    await setInputDevice((event.target as HTMLSelectElement).value);
  } catch (error: unknown) {
    audioSettingsError.value = microphoneErrorMessage(error, "无法切换麦克风");
  }
}

async function onOutputDeviceChange(event: Event) {
  audioSettingsError.value = "";
  try {
    await setOutputDevice((event.target as HTMLSelectElement).value);
  } catch (error: unknown) {
    audioSettingsError.value = localizedMessage(error instanceof Error ? error.message : "无法切换扬声器");
  }
}

async function toggleMicTest() {
  audioSettingsError.value = "";
  try {
    if (microphoneTestActive.value) stopMicrophoneTest();
    else await startMicrophoneTest();
  } catch (error: unknown) {
    audioSettingsError.value = microphoneErrorMessage(error);
  }
}

function microphoneErrorMessage(error: unknown, fallback = "请检查浏览器权限") {
  const name = error instanceof DOMException ? error.name : "";
  const reasons: Record<string, string> = {
    NotAllowedError: "浏览器未授予麦克风权限",
    NotFoundError: "未找到可用的麦克风",
    NotReadableError: "麦克风可能正被其他程序占用",
    OverconstrainedError: "所选麦克风当前不可用",
    SecurityError: "浏览器阻止了麦克风访问",
  };
  return `麦克风访问失败：${reasons[name] ?? fallback}`;
}

const micMeterBars = computed(() => Math.round(micLevel.value * 24));
function meterBarHeight(index: number) {
  if (!microphoneTestActive.value) return 5;
  const intensity = Math.max(0, micLevel.value - (index / 24) * 0.65);
  return 5 + Math.round(intensity * 34);
}

function toggleMicrophone(): void {
  setMicrophoneMuted(!microphoneMuted.value);
  showToast(microphoneMuted.value ? t("microphoneMuted") : t("microphoneActive"));
}

async function toggleAccompaniment(): Promise<void> {
  try {
    if (accompanimentActive.value) {
      await stopAccompaniment();
      showToast(t("accompanimentStopped"));
      return;
    }
    await startAccompaniment();
    if (accompanimentActive.value) showToast(t("accompanimentStarted"));
  } catch {
    const messageKey = accompanimentErrorCode.value === "needsWebRtc"
      ? "accompanimentNeedsWebRtc"
      : accompanimentErrorCode.value === "noAudio"
        ? "accompanimentNoAudio"
        : accompanimentErrorCode.value === "unsupported"
          ? "accompanimentUnsupported"
          : "accompanimentPermissionDenied";
    showToast(t(messageKey));
  }
}

function onWhisperPttDown(event: PointerEvent): void {
  if (!whisperTargetIds.size) return;
  const target = event.currentTarget as HTMLElement | null;
  if (target?.setPointerCapture && !target.hasPointerCapture(event.pointerId)) target.setPointerCapture(event.pointerId);
  whisperPttActive.value = true;
  setWhisperActive(true);
}

function onWhisperPttUp(event: PointerEvent): void {
  const target = event.currentTarget as HTMLElement | null;
  if (target?.releasePointerCapture && target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
  stopWhisperTalk();
}

function stopWhisperTalk(): void {
  if (!whisperPttActive.value) return;
  whisperPttActive.value = false;
  setWhisperActive(false);
}
</script>

<style scoped>
:global(*) { box-sizing: border-box; }
:global(body) { margin: 0; background: #f7f9f8; color: #192120; font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
:global(button), :global(input) { font: inherit; }
:global(button) { border: 0; }

.web-client { min-height: 100dvh; outline: none; background: #f7f9f8; color: #192120; }
.join-page { min-height: 100dvh; display: flex; flex-direction: column; overflow: hidden; background: #f7f9f8; }
.join-header, .join-content, .join-footer { width: min(1240px, calc(100% - 64px)); margin: 0 auto; }
.join-header, .join-content, .join-footer { position: relative; z-index: 1; }
.join-header { min-height: 84px; display: flex; align-items: center; justify-content: space-between; }
.brand-lockup { display: flex; align-items: center; gap: 12px; }
.brand-mark, .rail-logo { display: grid; place-items: center; color: #fff; background: #006a64; box-shadow: 0 8px 18px rgba(0, 106, 100, .15); }
.brand-mark { display: block; width: 40px; height: 40px; border-radius: 12px; object-fit: cover; }
.brand-lockup strong { display: block; color: #006a64; font-size: 18px; letter-spacing: -.04em; }
.brand-lockup strong span { color: #24312f; font-weight: 500; }
.brand-lockup small { display: block; margin-top: 2px; color: #7b8885; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
.header-tools { display: flex; align-items: center; gap: 17px; }
.github-button { display: inline-flex; align-items: center; gap: 8px; min-height: 34px; padding: 0 13px; color: #fff; background: #1f2d2b; border: 1px solid #1f2d2b; border-radius: 9px; box-shadow: 0 5px 12px rgba(31,45,43,.16); font-size: 12px; font-weight: 800; text-decoration: none; transition: .18s; }
.github-button:hover { color: #fff; background: #006a64; border-color: #006a64; box-shadow: 0 7px 16px rgba(0,106,100,.2); transform: translateY(-1px); }
.github-button .ui-icon { flex: 0 0 auto; }
.version-badge { display: inline-flex; align-items: center; min-height: 30px; padding: 0 9px; color: #006a64; background: #e7f4f1; border: 1px solid #cfe9e4; border-radius: 999px; font-size: 11px; font-weight: 800; letter-spacing: .02em; white-space: nowrap; }
.changelog-button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 30px; padding: 0 10px; color: #006a64; background: #f2f8f6; border: 1px solid #dcebe7; border-radius: 8px; font-size: 11px; font-weight: 700; text-decoration: none; transition: .18s; }
.changelog-button:hover { color: #fff; background: #006a64; border-color: #006a64; }
.header-note { display: flex; align-items: center; gap: 8px; color: #71807c; font-size: 12px; }
.language-switch { min-width: 50px; min-height: 28px; padding: 0 9px; color: #006a64; background: #e2f2ef; border: 1px solid #c8e6e1; border-radius: 7px; font-size: 10px; font-weight: 700; cursor: pointer; transition: .18s; }
.language-switch:hover { color: #fff; background: #006a64; border-color: #006a64; }
.language-select { min-width: 82px; min-height: 28px; padding: 0 24px 0 9px; color: #006a64; background: #e2f2ef; border: 1px solid #c8e6e1; border-radius: 7px; font-size: 10px; font-weight: 700; cursor: pointer; }
.language-select:focus-visible { outline: 3px solid #69d2c7; outline-offset: 2px; }
.language-menu-row { display: flex; align-items: center; gap: 10px; }
.language-menu-row > span { flex: 1; }
.tiny-dot, .online-dot, .status-pulse { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #65d879; box-shadow: 0 0 0 4px rgba(101, 216, 121, .14); }
.join-content { flex: 1; display: grid; grid-template-columns: minmax(0, 1fr) minmax(480px, 520px); align-items: center; gap: clamp(40px, 6vw, 88px); padding: 38px 0 56px; }
.join-copy { max-width: 630px; }
.eyebrow, .room-eyebrow { display: flex; align-items: center; gap: 9px; color: #006a64; font-size: 11px; font-weight: 700; letter-spacing: .13em; text-transform: uppercase; }
.eyebrow-dot { width: 9px; height: 9px; border-radius: 50%; background: #90f691; }
.join-copy h1 { margin: 20px 0 18px; color: #192120; font-size: clamp(42px, 5.3vw, 72px); line-height: 1.04; letter-spacing: -.075em; }
.join-copy h1 em { color: #006a64; font-style: normal; }
.join-description { max-width: 500px; margin: 0; color: #65736f; font-size: 17px; line-height: 1.75; }
.promise-list { display: flex; flex-wrap: wrap; gap: 24px; margin-top: 42px; }
.promise-item { display: flex; align-items: center; gap: 10px; min-width: 160px; }
.promise-icon { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; color: #006a64; background: #d8f3ef; }
.promise-icon.mint { color: #258844; background: #e0f6e1; }
.promise-icon.sand { color: #9c6739; background: #f7ebdc; }
.promise-item b, .promise-item small { display: block; }
.promise-item b { color: #283431; font-size: 12px; }
.promise-item small { margin-top: 3px; color: #87938f; font-size: 10px; }
.join-card { padding: 30px; border: 1px solid rgba(214, 226, 223, .8); border-radius: 20px; background: rgba(255, 255, 255, .86); box-shadow: 0 20px 52px rgba(35, 68, 63, .08); backdrop-filter: blur(12px); }
.card-kicker, .section-kicker { color: #79918c; font-size: 10px; font-weight: 700; letter-spacing: .16em; }
.join-card h2 { margin: 10px 0 7px; color: #1b2825; font-size: 27px; letter-spacing: -.045em; }
.card-lead { margin: 0 0 18px; color: #7b8885; font-size: 13px; }
.notice { display: flex; align-items: flex-start; gap: 10px; margin: 0 0 10px; padding: 9px 10px; border-radius: 10px; font-size: 12px; line-height: 1.45; }
.error-notice { color: #a53c38; background: #fff0ef; border: 1px solid #f7d4d1; }
.warning-notice { color: #8a6537; background: #fff8e9; border: 1px solid #f2dfb3; }
.notice-symbol { display: grid; place-items: center; width: 16px; height: 16px; flex: 0 0 auto; border-radius: 50%; color: #fff; background: currentColor; color: #fff; font-size: 10px; font-weight: 800; }
.error-notice .notice-symbol { background: #d95d55; }
.warning-notice .notice-symbol { background: #c89143; }
.join-form { display: grid; gap: 6px; }
.field-grid { display: grid; grid-template-columns: minmax(0, 1fr) 132px; gap: 12px; }
.field-grid .field-label { display: block; }
.field-grid .field-label:not(:first-child) { margin-top: 0; }
.field-hint { margin: 1px 0 5px; color: #879590; font-size: 10px; line-height: 1.5; }
.field-label, .settings-label { color: #43514d; font-size: 11px; font-weight: 600; }
.field-label:not(:first-child) { margin-top: 6px; }
.field-label span { color: #a2aaa7; font-weight: 400; }
.field-wrap { display: flex; align-items: center; gap: 10px; min-height: 42px; padding: 0 14px; color: #8b9b96; border-radius: 10px; background: #f3f6f5; transition: .2s ease; }
.field-wrap:focus-within { color: #006a64; background: #fff; box-shadow: 0 0 0 2px #81d8d0; }
.field-wrap input { width: 100%; min-width: 0; padding: 0; color: #24312f; outline: none; border: 0; background: transparent; font-size: 13px; }
.field-wrap input::placeholder { color: #a5b0ad; }
.primary-button { display: inline-flex; align-items: center; justify-content: center; gap: 10px; color: #fff; background: #006a64; border-radius: 9px; font-size: 12px; font-weight: 700; cursor: pointer; transition: transform .18s, box-shadow .18s, background .18s; }
.primary-button:hover:not(:disabled) { background: #005650; box-shadow: 0 9px 20px rgba(0, 106, 100, .18); transform: translateY(-1px); }
.primary-button:active:not(:disabled) { transform: translateY(0); }
.primary-button:disabled { cursor: not-allowed; opacity: .45; }
.connect-button { width: 100%; min-height: 44px; margin-top: 10px; font-size: 13px; }
.button-spinner { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,.4); border-top-color: #fff; border-radius: 50%; animation: spin .8s linear infinite; }
.join-meta { display: flex; align-items: center; justify-content: center; gap: 7px; margin-top: 12px; color: #96a29f; font-size: 10px; }
.join-footer { display: flex; align-items: center; min-height: 68px; color: #9ba6a3; border-top: 1px solid #e8edeb; font-size: 11px; }.join-footer a { color: #628e89; text-decoration: none; }.join-footer a:hover { color: #006a64; text-decoration: underline; }
.footer-separator { margin: 0 8px; color: #ccd5d1; }.footer-spacer { flex: 1; }

.app-shell { display: grid; grid-template-columns: 76px 292px minmax(0, 1fr) 246px; height: 100dvh; overflow: hidden; background: #fff; }
.nav-rail { display: flex; flex-direction: column; align-items: center; padding: 17px 0 14px; color: #52615d; background: #f1f4f3; border-right: 1px solid #e1e9e6; }
.rail-logo { width: 42px; height: 42px; border-radius: 13px; }
.rail-nav { display: flex; flex-direction: column; gap: 8px; margin-top: 40px; }
.rail-button { position: relative; display: flex; flex-direction: column; align-items: center; gap: 5px; width: 58px; padding: 8px 0; color: #7b8a85; background: transparent; border-radius: 10px; cursor: pointer; transition: .18s ease; }
.rail-button span { font-size: 9px; font-weight: 600; }
.rail-button:hover, .rail-button.active { color: #006a64; background: #dcefeb; }
.rail-button.active::before { position: absolute; left: -9px; top: 11px; width: 3px; height: 27px; border-radius: 0 3px 3px 0; background: #006a64; content: ""; }
.rail-bottom { display: flex; flex-direction: column; align-items: center; gap: 12px; margin-top: auto; }
.rail-avatar { display: grid; place-items: center; width: 34px; height: 34px; color: #fff; background: #006a64; border: 3px solid #fff; border-radius: 50%; font-size: 11px; font-weight: 700; box-shadow: 0 2px 8px rgba(0,0,0,.08); cursor: pointer; }
.channel-sidebar { display: flex; flex-direction: column; min-width: 0; color: #2b3935; background: #f8faf9; border-right: 1px solid #e6ecea; }
.sidebar-server { display: flex; align-items: center; gap: 10px; min-height: 73px; padding: 15px 15px 12px; border-bottom: 1px solid #e6ecea; }
.server-avatar { display: grid; place-items: center; width: 36px; height: 36px; flex: 0 0 auto; color: #006a64; background: #d8f0ed; border-radius: 10px; }
.server-heading { min-width: 0; flex: 1; }.server-heading strong, .server-heading span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.server-heading strong { color: #24312f; font-size: 12px; }.server-heading span { margin-top: 4px; color: #84918d; font-size: 10px; }.server-heading i { display: inline-block; width: 6px; height: 6px; margin-right: 4px; border-radius: 50%; background: #65d879; }
.round-icon { display: grid; place-items: center; width: 31px; height: 31px; flex: 0 0 auto; color: #71817c; background: transparent; border-radius: 8px; cursor: pointer; transition: .18s; }.round-icon:hover { color: #006a64; background: #e4efec; }
.sidebar-profile { display: flex; align-items: center; gap: 10px; padding: 18px 17px 14px; }.profile-avatar, .dock-avatar { display: grid; place-items: center; flex: 0 0 auto; color: #fff; border-radius: 11px; font-weight: 700; }.profile-avatar { width: 38px; height: 38px; font-size: 12px; }.profile-copy { min-width: 0; flex: 1; }.profile-copy strong, .profile-copy span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.profile-copy strong { color: #263530; font-size: 12px; }.profile-copy span { margin-top: 4px; color: #7d8e88; font-size: 10px; }.profile-settings { display: grid; place-items: center; color: #7d8e88; background: transparent; cursor: pointer; }.profile-settings:hover { color: #006a64; }
.channel-search, .member-search { display: flex; align-items: center; gap: 8px; color: #85928e; background: #eef3f1; border-radius: 8px; }.channel-search { margin: 0 14px 18px; padding: 0 10px; min-height: 34px; }.channel-search input, .member-search input { width: 100%; min-width: 0; border: 0; outline: none; background: transparent; color: #40504b; font-size: 11px; }.channel-search input::placeholder, .member-search input::placeholder { color: #9ba6a3; }.channel-search kbd { padding: 2px 5px; color: #9aa7a3; background: #fff; border: 1px solid #dbe4e0; border-radius: 4px; font-size: 9px; }
.sidebar-scroll { flex: 1; overflow-y: auto; padding-bottom: 14px; }.channel-section-title { display: flex; align-items: center; justify-content: space-between; padding: 0 14px 8px; color: #82908c; font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }.channel-section-title button { display: grid; place-items: center; padding: 2px; color: #87958f; background: transparent; cursor: pointer; }.channel-section-title button:hover { color: #006a64; }
.channel-entry { display: flex; align-items: center; gap: 9px; min-height: 46px; padding-right: 12px; color: #56635f; cursor: pointer; transition: .16s; }.channel-entry:hover { background: #eef5f2; }.channel-entry.selected { color: #006a64; background: #dcefeb; }.channel-entry-copy { min-width: 0; flex: 1; }.channel-entry-copy strong, .channel-entry-copy span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.channel-entry-copy strong { font-size: 12px; font-weight: 600; }.channel-entry-copy span { margin-top: 3px; color: #93a09c; font-size: 9px; }.channel-entry.selected .channel-entry-copy span { color: #4c9690; }.channel-selected-mark { margin-left: auto; color: #006a64; }.channel-member-preview { display: flex; flex-direction: column; gap: 6px; padding: 3px 12px 8px 0; color: #74827e; font-size: 10px; }.mini-member { display: flex; align-items: center; gap: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.mini-avatar { display: grid; place-items: center; width: 18px; height: 18px; flex: 0 0 auto; color: #fff; border-radius: 6px; font-size: 8px; font-weight: 700; }.mini-member b { margin-left: auto; color: #006a64; font-size: 9px; }.more-members { color: #006a64; font-size: 9px; }.channel-empty { margin: 5px 14px 0; padding: 19px 14px; color: #8a9793; border: 1px dashed #d3dfdb; border-radius: 10px; text-align: center; }.empty-icon { display: grid; place-items: center; width: 34px; height: 34px; margin: 0 auto 9px; color: #6aa9a3; background: #e2f2ef; border-radius: 10px; }.channel-empty strong { display: block; color: #5a6964; font-size: 11px; }.channel-empty p { margin: 6px 0 12px; font-size: 10px; line-height: 1.5; }.channel-empty button { display: inline-flex; align-items: center; gap: 5px; padding: 6px 9px; color: #006a64; background: #e0f3f0; border-radius: 6px; font-size: 10px; cursor: pointer; }.sidebar-divider { height: 1px; margin: 18px 14px; background: #e2e9e6; }.quick-action { display: flex; align-items: center; gap: 10px; width: calc(100% - 28px); margin: 2px 14px; padding: 9px 5px; color: #6d7c77; background: transparent; text-align: left; cursor: pointer; }.quick-action:hover { color: #006a64; }.quick-action span { flex: 1; font-size: 11px; }.quick-action .ui-icon:last-child { color: #a6b2ae; }.sidebar-footer { display: flex; align-items: center; gap: 7px; min-height: 43px; padding: 0 16px; color: #75837e; border-top: 1px solid #e6ecea; font-size: 10px; }.footer-latency { margin-left: auto; color: #a0ada8; font-size: 9px; }

.workspace { display: flex; min-width: 0; flex-direction: column; background: #fff; }.workspace-header { display: flex; align-items: center; justify-content: space-between; min-height: 73px; padding: 0 29px; border-bottom: 1px solid #eef2f0; }.breadcrumbs { display: flex; align-items: center; gap: 9px; min-width: 0; color: #52605b; font-size: 12px; }.breadcrumbs strong { overflow: hidden; color: #26332f; text-overflow: ellipsis; white-space: nowrap; }.crumb-muted { color: #98a39f; }.mobile-brand { display: none; color: #006a64; font-size: 17px; font-weight: 800; letter-spacing: -.06em; }.mobile-brand em { color: #293632; font-style: normal; font-weight: 500; }.workspace-actions, .dock-actions { display: flex; align-items: center; gap: 8px; }.header-action, .dock-icon { display: grid; place-items: center; color: #75847f; background: transparent; border-radius: 8px; cursor: pointer; transition: .16s; }.header-action { width: 32px; height: 32px; }.header-action:hover, .dock-icon:hover { color: #006a64; background: #edf5f2; }.disconnect-button { display: inline-flex; align-items: center; gap: 6px; min-height: 33px; margin-left: 8px; padding: 0 13px; color: #a94d48; background: #fff2f1; border-radius: 8px; font-size: 11px; font-weight: 700; cursor: pointer; }.disconnect-button:hover { color: #fff; background: #c95a54; }
.workspace { display: flex; min-width: 0; flex-direction: column; background: #fff; }.workspace-header { display: flex; align-items: center; justify-content: space-between; min-height: 73px; padding: 0 29px; border-bottom: 1px solid #eef2f0; }.breadcrumbs { display: flex; align-items: center; gap: 9px; min-width: 0; color: #52605b; font-size: 12px; }.breadcrumbs strong { overflow: hidden; color: #26332f; text-overflow: ellipsis; white-space: nowrap; }.crumb-muted { color: #98a39f; }.mobile-brand { display: none; color: #006a64; font-size: 17px; font-weight: 800; letter-spacing: -.06em; }.mobile-brand em { color: #293632; font-style: normal; font-weight: 500; }.workspace-actions, .dock-actions { display: flex; align-items: center; gap: 8px; }.header-action, .dock-icon { display: grid; place-items: center; color: #75847f; background: transparent; border-radius: 8px; cursor: pointer; transition: .16s; }.header-action { width: 32px; height: 32px; }.header-action:hover, .dock-icon:hover { color: #006a64; background: #edf5f2; }.workspace-language { margin-left: 3px; }.disconnect-button { display: inline-flex; align-items: center; gap: 6px; min-height: 33px; margin-left: 8px; padding: 0 13px; color: #a94d48; background: #fff2f1; border-radius: 8px; font-size: 11px; font-weight: 700; cursor: pointer; }.disconnect-button:hover { color: #fff; background: #c95a54; }
.workspace-scroll { flex: 1; overflow-y: auto; }.workspace-content { width: min(950px, calc(100% - 64px)); margin: 0 auto; padding: 31px 0 27px; }.room-hero { position: relative; min-height: 190px; overflow: hidden; padding: 30px 34px; border-radius: 16px; background: linear-gradient(110deg, #e3f4f1, #f8fbfa 68%, #fff); }.room-hero-content { position: relative; z-index: 1; }.room-eyebrow { color: #4d817a; font-size: 10px; }.live-pill { display: inline-flex; align-items: center; gap: 5px; padding: 4px 8px; color: #2d7540; background: #d6f5d9; border-radius: 999px; font-size: 9px; letter-spacing: .08em; }.live-pill i { width: 5px; height: 5px; border-radius: 50%; background: #56cf69; }.room-hero h1 { display: flex; align-items: center; gap: 8px; margin: 16px 0 7px; color: #18302c; font-size: 26px; letter-spacing: -.05em; }.room-hero h1 .ui-icon { color: #006a64; }.room-hero p { max-width: 470px; margin: 0; color: #64817a; font-size: 12px; line-height: 1.6; }.room-stats { display: flex; align-items: center; gap: 11px; margin-top: 19px; color: #52716b; font-size: 10px; }.room-stats span { display: inline-flex; align-items: center; gap: 5px; }.stat-divider { width: 1px; height: 13px; background: #b8d9d4; }.hero-decoration { position: absolute; border: 1px solid rgba(0,106,100,.12); border-radius: 50%; }.hero-decoration.one { width: 250px; height: 250px; right: 48px; top: -116px; }.hero-decoration.two { width: 355px; height: 355px; right: -20px; top: -168px; }.hero-visual { position: absolute; right: 85px; bottom: 20px; width: 160px; height: 120px; opacity: .75; }.orbit { position: absolute; inset: 16px 4px; border: 1px solid rgba(0,106,100,.19); border-radius: 50%; transform: rotate(28deg); }.orbit-b { inset: 0 26px; transform: rotate(-49deg); }.hero-wave { position: absolute; right: 29px; bottom: 45px; display: flex; align-items: center; gap: 4px; height: 53px; }.hero-wave i { display: block; width: 3px; min-height: 8px; border-radius: 4px; background: #63c7bf; animation: wave 2.2s ease-in-out infinite alternate; }.hero-wave i:nth-child(3n) { background: #90f691; animation-delay: -.8s; }.hero-wave i:nth-child(4n) { animation-delay: -.4s; }
.section-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; }.voice-section { margin-top: 34px; }.section-heading h2 { display: flex; align-items: center; gap: 7px; margin: 6px 0 0; color: #1d2926; font-size: 20px; letter-spacing: -.04em; }.section-counter { color: #87928e; font-size: 10px; }.voice-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(142px, 1fr)); gap: 12px; margin-top: 17px; }.voice-card { min-height: 152px; padding: 17px 11px 13px; border: 1px solid #edf1ef; border-radius: 13px; background: #fff; box-shadow: 0 7px 18px rgba(20,58,51,.04); text-align: center; transition: .18s; }.voice-card:hover { transform: translateY(-2px); box-shadow: 0 11px 24px rgba(20,58,51,.08); }.voice-card.speaking { border-color: #90f691; box-shadow: 0 0 14px rgba(144,246,145,.35); }.voice-avatar-wrap { position: relative; width: 68px; margin: 0 auto 11px; }.voice-avatar { display: grid; place-items: center; width: 68px; height: 68px; color: #fff; border-radius: 50%; font-size: 20px; font-weight: 700; }.voice-status { position: absolute; right: -2px; bottom: -2px; display: grid; place-items: center; width: 24px; height: 24px; color: #78908b; background: #fff; border: 1px solid #e0eae6; border-radius: 50%; }.voice-status.speaking { color: #278c3b; border-color: #90f691; }.voice-card > strong, .voice-card > span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.voice-card > strong { color: #2c3935; font-size: 12px; }.voice-card > span { margin-top: 5px; color: #91a09a; font-size: 10px; }.voice-card.speaking > span { color: #278c3b; }.more-card { display: grid; place-items: center; align-content: center; }.more-count { display: grid; place-items: center; width: 54px; height: 54px; margin-bottom: 11px; color: #006a64; background: #e0f2ef; border-radius: 50%; font-size: 14px; font-weight: 700; }.voice-empty { display: flex; align-items: center; gap: 11px; margin-top: 17px; padding: 18px; color: #83908c; border: 1px dashed #dce6e2; border-radius: 12px; font-size: 11px; }.voice-empty .empty-icon { margin: 0; width: 34px; height: 34px; }.voice-empty strong { color: #4c5e58; }.voice-empty span:last-child { margin-left: auto; }
.chat-panel { margin-top: 34px; padding: 0 0 16px; border-top: 1px solid #eef2f0; }.chat-heading { padding-top: 25px; }.chat-heading h2 .ui-icon { color: #006a64; }.message-list { display: flex; flex-direction: column; gap: 18px; min-height: 170px; max-height: 360px; overflow-y: auto; padding: 22px 8px 10px 3px; }.chat-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 145px; color: #9aa6a2; text-align: center; }.chat-empty-icon { display: grid; place-items: center; width: 48px; height: 48px; margin-bottom: 11px; color: #6fa8a2; background: #e5f3f1; border-radius: 14px; }.chat-empty strong { color: #556761; font-size: 12px; }.chat-empty span { margin-top: 5px; font-size: 10px; }.message-row { display: flex; align-items: flex-start; gap: 11px; max-width: 78%; }.message-row.mine { align-self: flex-end; flex-direction: row-reverse; }.message-avatar { display: grid; place-items: center; width: 32px; height: 32px; flex: 0 0 auto; color: #fff; border-radius: 10px; font-size: 11px; font-weight: 700; }.message-body { min-width: 0; }.message-meta { display: flex; align-items: baseline; gap: 8px; margin: 1px 0 6px; }.message-row.mine .message-meta { justify-content: flex-end; }.message-meta strong { color: #384843; font-size: 11px; }.message-meta time { color: #a1ada9; font-size: 9px; }.message-bubble { padding: 10px 13px; color: #43534e; background: #f1f5f3; border-radius: 4px 13px 13px 13px; font-size: 12px; line-height: 1.55; }.message-row.mine .message-bubble { color: #fff; background: #006a64; border-radius: 13px 4px 13px 13px; }.message-composer { display: flex; align-items: center; gap: 7px; min-height: 48px; padding: 6px 8px 6px 12px; background: #f3f6f5; border-radius: 11px; }.message-composer input { width: 100%; min-width: 0; border: 0; outline: none; background: transparent; color: #3a4944; font-size: 12px; }.message-composer input::placeholder { color: #9aa6a2; }.composer-tool { display: grid; place-items: center; width: 30px; height: 30px; flex: 0 0 auto; color: #94a19d; background: transparent; border-radius: 7px; }.composer-tool:not(:disabled) { cursor: pointer; }.composer-tool:disabled { opacity: .6; }.send-button { display: grid; place-items: center; width: 34px; height: 34px; flex: 0 0 auto; color: #fff; background: #006a64; border-radius: 9px; cursor: pointer; }.send-button:disabled { cursor: not-allowed; opacity: .35; }
.control-dock { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 74px; padding: 10px 29px; border-top: 1px solid #e9efec; background: rgba(255,255,255,.94); box-shadow: 0 -5px 18px rgba(23,52,47,.03); }.dock-user { display: flex; align-items: center; gap: 9px; min-width: 140px; }.dock-avatar { width: 34px; height: 34px; border-radius: 10px; font-size: 11px; }.dock-user strong, .dock-user span { display: block; }.dock-user strong { max-width: 125px; overflow: hidden; color: #33423d; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }.dock-user span { display: flex; align-items: center; gap: 5px; margin-top: 4px; color: #7e8d87; font-size: 9px; }.dock-user span i { width: 5px; height: 5px; border-radius: 50%; background: #65d879; }.dock-center { display: flex; align-items: center; gap: 14px; }.mic-mode-switch { display: flex; padding: 3px; background: #eef3f1; border-radius: 8px; }.mic-mode-switch button { display: inline-flex; align-items: center; gap: 5px; padding: 7px 9px; color: #8b9894; background: transparent; border-radius: 6px; font-size: 10px; cursor: pointer; }.mic-mode-switch button.active { color: #006a64; background: #fff; box-shadow: 0 2px 5px rgba(21,54,48,.08); font-weight: 700; }.ptt-indicator { display: inline-flex; align-items: center; gap: 7px; color: #7c8b86; font-size: 10px; }.ptt-indicator span { width: 7px; height: 7px; border-radius: 50%; background: #b2bfbb; }.ptt-indicator.active { color: #278c3b; }.ptt-indicator.active span { background: #65d879; box-shadow: 0 0 0 4px rgba(101,216,121,.15); }.dock-actions { min-width: 140px; justify-content: flex-end; }.dock-icon { width: 34px; height: 34px; }.dock-end { display: grid; place-items: center; width: 37px; height: 37px; color: #fff; background: #c95a54; border-radius: 10px; cursor: pointer; }.dock-end:hover { background: #b84c47; }

.member-panel { min-width: 0; padding: 26px 16px; color: #2c3935; background: #fbfcfc; border-left: 1px solid #eef2f0; }.member-panel-heading { display: flex; align-items: flex-start; justify-content: space-between; }.member-panel-heading h2 { margin: 5px 0 0; color: #25322e; font-size: 19px; letter-spacing: -.04em; }.member-search { margin-top: 18px; padding: 0 10px; min-height: 33px; }.member-group { margin-top: 24px; }.member-group-title { display: flex; align-items: center; gap: 8px; color: #85928e; font-size: 9px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }.group-line { height: 1px; flex: 1; background: #e6edeb; }.member-list { display: flex; flex-direction: column; gap: 17px; margin-top: 17px; }.member-row { display: flex; align-items: center; gap: 8px; min-width: 0; }.member-avatar { position: relative; display: grid; place-items: center; width: 33px; height: 33px; flex: 0 0 auto; color: #fff; border-radius: 10px; font-size: 10px; font-weight: 700; }.member-avatar.speaking { box-shadow: 0 0 0 2px #90f691, 0 0 10px rgba(144,246,145,.35); }.member-presence { position: absolute; right: -2px; bottom: -2px; width: 9px; height: 9px; border: 2px solid #fbfcfc; border-radius: 50%; background: #65d879; }.member-copy { min-width: 0; flex: 1; }.member-copy strong, .member-copy span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.member-copy strong { color: #34423d; font-size: 10px; }.member-copy span { margin-top: 4px; color: #96a29e; font-size: 9px; }.member-volume { display: flex; align-items: center; gap: 5px; color: #a1afaa; width: 64px; }.member-volume input { width: 45px; height: 4px; appearance: none; border-radius: 99px; outline: none; cursor: pointer; }.member-volume input::-webkit-slider-thumb, .settings-range::-webkit-slider-thumb { width: 14px; height: 14px; appearance: none; border: 2px solid #81d8d0; border-radius: 50%; background: #fff; box-shadow: 0 2px 4px rgba(0,0,0,.12); cursor: pointer; }.member-volume input::-moz-range-thumb, .settings-range::-moz-range-thumb { width: 14px; height: 14px; border: 2px solid #81d8d0; border-radius: 50%; background: #fff; box-shadow: 0 2px 4px rgba(0,0,0,.12); cursor: pointer; }.member-empty { margin-top: 22px; color: #98a49f; font-size: 10px; text-align: center; }.member-panel-tip { display: flex; gap: 8px; margin-top: 36px; padding: 12px; color: #72827c; background: #eef5f2; border-radius: 9px; font-size: 9px; line-height: 1.5; }.member-panel-tip .ui-icon { color: #5e9e96; }

.modal-backdrop { position: fixed; z-index: 20; inset: 0; display: grid; place-items: center; padding: 28px; background: rgba(25, 33, 31, .42); backdrop-filter: blur(5px); }.settings-modal { display: flex; width: min(920px, 100%); max-height: min(760px, calc(100dvh - 56px)); overflow: hidden; border-radius: 16px; background: #fff; box-shadow: 0 20px 60px rgba(16,40,35,.2); }.settings-nav { display: flex; flex-direction: column; width: 215px; flex: 0 0 auto; padding: 28px 12px 20px; background: #f8faf9; border-right: 1px solid #e6ecea; }.settings-title { padding: 0 13px 20px; color: #25322e; font-size: 19px; font-weight: 700; }.settings-nav-item { display: flex; align-items: center; gap: 12px; padding: 11px 13px; color: #65736f; background: transparent; border-left: 3px solid transparent; border-radius: 8px; font-size: 11px; text-align: left; cursor: pointer; }.settings-nav-item.active { color: #006a64; background: #e2efec; border-left-color: #006a64; font-weight: 700; }.settings-version { margin-top: auto; padding: 20px 13px 0; color: #98a5a0; border-top: 1px solid #e4ebe8; font-size: 10px; line-height: 1.7; }.settings-version span { color: #b0bbb7; }.settings-main { display: flex; min-width: 0; flex: 1; flex-direction: column; }.settings-header { display: flex; align-items: center; justify-content: space-between; min-height: 75px; padding: 0 28px; border-bottom: 1px solid #edf1ef; }.settings-header h2 { margin: 0; color: #202c29; font-size: 22px; letter-spacing: -.045em; }.settings-content { flex: 1; overflow-y: auto; padding: 28px 40px; }.settings-section { max-width: 620px; margin: 0 auto; }.settings-section h3 { display: flex; align-items: center; gap: 9px; margin: 0 0 21px; color: #293631; font-size: 16px; }.settings-section h3 .ui-icon { color: #006a64; }.settings-label { display: block; margin-bottom: 8px; color: #5e6d67; font-size: 10px; font-weight: 500; }.select-like { display: flex; align-items: center; justify-content: space-between; min-height: 39px; margin-bottom: 19px; padding: 0 13px; color: #394742; background: #f4f7f6; border-radius: 8px; font-size: 11px; }.select-like .ui-icon { color: #677671; }.settings-range-row { display: flex; align-items: center; justify-content: space-between; }.settings-range-row .settings-label { margin: 0; }.settings-range-row strong { color: #006a64; font-size: 10px; }.settings-range { width: 100%; height: 6px; margin: 11px 0 20px; appearance: none; border-radius: 999px; outline: none; cursor: pointer; }.settings-range::-webkit-slider-thumb { width: 19px; height: 19px; }.settings-range::-moz-range-thumb { width: 19px; height: 19px; }.mic-test { padding: 15px; border: 1px solid #e5ece9; border-radius: 11px; background: #fafcfb; }.mic-test-header { display: flex; align-items: center; justify-content: space-between; }.mic-test-header strong { color: #36453f; font-size: 11px; }.mic-test-header button { padding: 6px 9px; color: #006a64; background: #e0f1ee; border-radius: 5px; font-size: 10px; cursor: pointer; }.meter { display: flex; align-items: flex-end; justify-content: space-between; gap: 4px; height: 39px; margin-top: 12px; padding: 0 4px 4px; border-bottom: 1px solid #dce6e2; }.meter i { width: 5px; min-height: 4px; border-radius: 3px 3px 0 0; background: #dfe6e3; }.meter i.active { background: #81ed8b; box-shadow: 0 0 7px rgba(129,237,139,.45); animation: meter 1s ease-in-out infinite alternate; }.meter-labels { display: flex; justify-content: space-between; margin-top: 6px; color: #9ba6a2; font-size: 8px; }.settings-separator { max-width: 620px; margin: 32px auto; border-top: 1px solid #edf1ef; }.mode-note { display: flex; align-items: flex-start; gap: 8px; padding: 12px; color: #66817a; background: #eef7f4; border-radius: 8px; font-size: 10px; line-height: 1.5; }.mode-note .ui-icon { color: #4f9c91; }.settings-footer { display: flex; justify-content: flex-end; gap: 16px; min-height: 67px; padding: 15px 28px; border-top: 1px solid #edf1ef; }.text-button { padding: 0 6px; color: #63716c; background: transparent; font-size: 11px; font-weight: 600; cursor: pointer; }.save-button { padding: 0 23px; }.qq-modal-card { position: relative; width: min(460px, 100%); max-height: min(90dvh, 720px); overflow-y: auto; padding: 30px; color: #263431; border: 1px solid #d9e7e3; border-radius: 20px; background: #fff; box-shadow: 0 20px 60px rgba(16,40,35,.22); text-align: center; }.qq-modal-heading { padding: 0 24px 18px; }.qq-modal-heading h2 { margin: 8px 0 0; color: #1d2d29; font-size: 25px; letter-spacing: -.04em; }.qq-modal-close { position: absolute; top: 13px; right: 13px; display: grid; place-items: center; width: 34px; height: 34px; padding: 0; color: #6d7d78; background: #f1f6f4; border: 1px solid #e1ebe8; border-radius: 50%; cursor: pointer; }.qq-modal-close:hover { color: #006a64; background: #e2f2ef; border-color: #c8e6e1; }.qq-qr-image { display: block; width: min(100%, 360px); max-height: min(55vh, 520px); margin: 0 auto; object-fit: contain; border-radius: 12px; }.qq-direct-join { margin: 18px 0 9px; color: #667773; font-size: 13px; }.qq-join-link { display: block; padding: 11px 14px; color: #006a64; background: #edf8f5; border: 1px solid #cfe9e4; border-radius: 10px; font-size: 12px; font-weight: 700; line-height: 1.45; text-decoration: none; overflow-wrap: anywhere; }.qq-join-link:hover { color: #fff; background: #006a64; border-color: #006a64; }.toast { position: fixed; z-index: 30; right: 24px; bottom: 24px; display: flex; align-items: center; gap: 8px; padding: 11px 15px; color: #fff; background: #263e39; border-radius: 9px; box-shadow: 0 10px 24px rgba(16,48,42,.2); font-size: 11px; animation: toast-in .25s ease-out; }

@keyframes spin { to { transform: rotate(360deg); } } @keyframes wave { from { transform: scaleY(.68); opacity: .65; } to { transform: scaleY(1.08); opacity: 1; } } @keyframes meter { from { transform: scaleY(.65); } to { transform: scaleY(1); } } @keyframes toast-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

@keyframes join-fade-up { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
@keyframes join-title-in { from { opacity: 0; letter-spacing: -.02em; transform: translateY(18px) scale(.98); } to { opacity: 1; letter-spacing: -.075em; transform: translateY(0) scale(1); } }
@keyframes join-accent-breathe { 0%, 100% { transform: translateY(0); text-shadow: 0 0 0 rgba(0, 106, 100, 0); } 50% { transform: translateY(-2px); text-shadow: 0 5px 18px rgba(0, 106, 100, .16); } }
@keyframes join-dot-pulse { 0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(144, 246, 145, .28); } 50% { transform: scale(1.18); box-shadow: 0 0 0 6px rgba(144, 246, 145, 0); } }

.join-page .join-header { animation: join-fade-up .55s cubic-bezier(.22, 1, .36, 1) both; }
.join-page .join-copy .eyebrow { animation: join-fade-up .55s .08s cubic-bezier(.22, 1, .36, 1) both; }
.join-page .join-copy h1 { animation: join-title-in .78s .16s cubic-bezier(.22, 1, .36, 1) both; }
.join-page .join-copy h1 em { display: inline-block; animation: join-accent-breathe 5s 1.15s ease-in-out infinite; }
.join-page .join-description { animation: join-fade-up .58s .36s cubic-bezier(.22, 1, .36, 1) both; }
.join-page .promise-list { animation: join-fade-up .58s .48s cubic-bezier(.22, 1, .36, 1) both; }
.join-page .promise-item:nth-child(2) { animation: join-fade-up .58s .58s cubic-bezier(.22, 1, .36, 1) both; }
.join-page .promise-item:nth-child(3) { animation: join-fade-up .58s .68s cubic-bezier(.22, 1, .36, 1) both; }
.join-page .eyebrow-dot { animation: join-dot-pulse 2.8s .8s ease-in-out infinite; }
.join-page .join-card { animation: join-fade-up .68s .24s cubic-bezier(.22, 1, .36, 1) both; }
.join-page .join-footer { animation: join-fade-up .55s .72s cubic-bezier(.22, 1, .36, 1) both; }

@media (prefers-reduced-motion: reduce) {
  .join-page *, .join-page *::before, .join-page *::after { animation: none !important; transition-duration: .01ms !important; }
}

@media (max-width: 1200px) { .app-shell { grid-template-columns: 72px 255px minmax(0, 1fr) 218px; }.workspace-content { width: min(900px, calc(100% - 42px)); }.control-dock { padding-inline: 18px; }.dock-center { gap: 8px; }.mic-mode-switch button { padding-inline: 7px; }.member-panel { padding-inline: 12px; }.member-volume { display: none; } }
@media (max-width: 980px) { .app-shell { grid-template-columns: 70px 245px minmax(0, 1fr); }.member-panel { display: none; }.room-hero { min-height: 180px; }.hero-visual { right: 24px; opacity: .55; }.join-content { gap: 40px; }.join-card { padding: 28px; } }
@media (max-width: 740px) { .join-header, .join-content, .join-footer { width: min(100% - 32px, 560px); }.join-header { min-height: 70px; }.header-note { display: none; }.join-content { display: flex; flex-direction: column; align-items: stretch; justify-content: center; gap: 35px; padding: 36px 0 48px; }.join-copy h1 { margin-top: 15px; font-size: 45px; }.join-description { font-size: 14px; }.promise-list { gap: 13px; margin-top: 27px; }.promise-item { min-width: 0; flex: 1 1 30%; }.promise-item small { display: none; }.join-card { padding: 24px 20px; }.join-footer { min-height: 53px; }.join-footer .footer-spacer { display: none; }.join-footer span:last-child { margin-left: auto; }.field-grid { grid-template-columns: minmax(0, 1fr) 112px; gap: 8px; }.app-shell { display: block; height: 100dvh; }.nav-rail, .channel-sidebar, .member-panel { display: none; }.workspace { height: 100%; }.workspace-header { min-height: 61px; padding: 0 15px; }.mobile-brand { display: inline; }.crumb-muted, .breadcrumbs > .ui-icon, .breadcrumbs > strong { display: none; }.workspace-actions { gap: 3px; }.disconnect-button { margin-left: 2px; padding-inline: 9px; }.disconnect-button .ui-icon { display: none; }.workspace-content { width: calc(100% - 30px); padding-top: 18px; }.room-hero { min-height: 182px; padding: 23px 21px; }.room-hero h1 { font-size: 22px; }.room-hero p { max-width: 74%; font-size: 11px; }.hero-visual { right: -15px; bottom: 4px; transform: scale(.75); transform-origin: right bottom; }.voice-section, .chat-panel { margin-top: 25px; }.voice-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }.voice-card { min-height: 143px; }.message-row { max-width: 92%; }.control-dock { min-height: 66px; padding: 8px 15px; }.dock-user { min-width: 0; }.dock-user > div:last-child { display: none; }.dock-center { flex: 1; justify-content: center; }.mic-mode-switch button { padding: 6px 7px; font-size: 9px; }.ptt-indicator { display: none; }.dock-actions { min-width: 75px; }.settings-modal { max-height: calc(100dvh - 28px); }.settings-nav { display: none; }.settings-content { padding: 24px 20px; }.settings-header { min-height: 62px; padding-inline: 20px; }.settings-header h2 { font-size: 19px; }.settings-footer { min-height: 61px; padding-inline: 20px; } }
@media (max-width: 420px) { .join-copy h1 { font-size: 38px; }.promise-list { display: grid; grid-template-columns: 1fr; }.promise-item small { display: block; }.join-card { border-radius: 15px; }.voice-grid { gap: 8px; }.voice-card { padding-inline: 6px; }.section-counter { display: none; }.workspace-actions .header-action:first-child { display: none; }.dock-icon { display: none; }.dock-actions { min-width: 37px; }.room-stats { gap: 6px; }.room-stats span:last-child, .stat-divider { display: none; } }

/* The connected view keeps only controls that have a working action. The
   channel tree lives with the member list so every channel remains visible
   even when the current user is elsewhere. */
.app-shell { grid-template-columns: minmax(0, 1fr) 318px; }
.nav-rail, .channel-sidebar { display: none; }
.workspace { min-width: 0; }
.identity-options { margin-top: 8px; color: #677872; font-size: 11px; }
.identity-options summary { width: fit-content; color: #277970; cursor: pointer; }
.identity-options[open] summary { margin-bottom: 10px; }
.cancel-connect-button { justify-self: center; min-height: 32px; padding: 0 10px; color: #6b7d77; background: transparent; font-size: 11px; cursor: pointer; }
.cancel-connect-button:hover { color: #006a64; text-decoration: underline; }
.channel-switcher { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 8px; color: #006a64; background: #edf7f4; border: 1px solid #d7ebe6; border-radius: 8px; }
.channel-switcher select { max-width: 165px; padding: 0 2px; color: #31514b; border: 0; outline: 0; background: transparent; font-size: 11px; cursor: pointer; }
.member-panel { display: flex; flex-direction: column; min-height: 0; padding: 26px 18px 18px; overflow: hidden; }
.member-tree { flex: 1; min-height: 0; margin-top: 18px; padding-right: 3px; overflow-y: auto; }
.member-channel-group { padding: 8px 0 14px; border-bottom: 1px solid #e7eeeb; }
.member-channel-group + .member-channel-group { margin-top: 8px; }
.member-channel-heading { display: flex; align-items: center; gap: 7px; width: 100%; padding: 5px 4px; color: #52635d; background: transparent; border-radius: 7px; text-align: left; cursor: pointer; }
.member-channel-heading:hover, .member-channel-group.current .member-channel-heading { color: #006a64; background: #e5f3f0; }
.member-channel-heading span { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 700; }
.member-channel-heading small { color: #94a29d; font-size: 10px; }
.member-channel-group.current .member-channel-heading small { color: #4d9a92; }
.member-channel-group .member-list { gap: 13px; margin: 9px 4px 0 14px; }
.member-volume { display: flex; }
.channel-no-members { margin: 7px 4px 0 31px; color: #a0ada8; font-size: 10px; }
.member-panel-tip { flex: 0 0 auto; margin-top: 15px; }
.settings-modal { width: min(760px, 100%); }
.settings-nav { display: none; }
.settings-content { padding: 30px 42px; }
.settings-select { display: block; width: 100%; min-height: 42px; margin-bottom: 19px; padding: 0 13px; color: #394742; border: 1px solid #e0eae6; border-radius: 8px; outline: none; background: #f4f7f6; font-size: 11px; cursor: pointer; }
.settings-select:focus { border-color: #81d8d0; box-shadow: 0 0 0 2px rgba(129,216,208,.2); }
.settings-select:disabled { cursor: wait; opacity: .65; }
.settings-error { margin: -9px 0 15px; color: #b14e47; font-size: 10px; line-height: 1.5; }
.settings-footer { justify-content: flex-end; }
.reconnect-banner { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin: 14px auto 0; width: min(950px, calc(100% - 64px)); padding: 12px 16px; color: #6c5a2c; border: 1px solid #f0dfae; border-radius: 10px; background: #fff9e8; }
.reconnect-banner.failed { color: #8f4540; border-color: #f2d1cd; background: #fff2f1; }
.reconnect-copy { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.reconnect-copy strong { font-size: 13px; }
.reconnect-copy span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
.reconnect-actions { display: flex; align-items: center; gap: 12px; flex: 0 0 auto; }
.reconnect-actions .secondary-button { min-height: 34px; padding-inline: 13px; }
.remember-identity { display: flex; align-items: flex-start; gap: 9px; margin-top: 8px; color: #465650; cursor: pointer; }
.remember-identity input { width: 16px; height: 16px; flex: 0 0 auto; margin: 1px 0 0; accent-color: #087d74; }
.remember-identity strong, .remember-identity small { display: block; }
.remember-identity strong { font-size: 11px; font-weight: 700; }
.remember-identity small { margin-top: 3px; color: #8b9994; font-size: 10px; line-height: 1.4; }
.identity-warning { margin: 8px 0 0; color: #9a6a32; font-size: 10px; line-height: 1.45; }
.local-servers { display: grid; gap: 8px; margin: 1px 0 5px; }
.local-server-group { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
.local-server-group > span { width: 100%; color: #87958f; font-size: 10px; font-weight: 700; }
.local-server-group button, .favorite-toggle { padding: 5px 8px; color: #277970; background: #eef8f5; border: 1px solid #d7ebe6; border-radius: 6px; font-size: 10px; cursor: pointer; }
.local-server-group button:hover, .favorite-toggle:hover { background: #e0f3ee; }
.favorite-toggle { justify-self: start; margin: -1px 0 4px; }
.clear-local-button { padding: 0; color: #85928d; background: transparent; border: 0; font-size: 10px; cursor: pointer; }
.clear-local-button:hover { color: #b14e47; text-decoration: underline; }
@media (max-width: 740px) { .reconnect-banner { align-items: flex-start; flex-direction: column; gap: 10px; width: calc(100% - 30px); }.reconnect-copy { align-items: flex-start; flex-direction: column; gap: 4px; }.reconnect-actions { width: 100%; justify-content: flex-end; } }
.save-button { min-height: 38px; }

/* Increase connected-view typography by 25% while keeping the layout compact. */
.app-shell .breadcrumbs { font-size: 15px; }
.app-shell .channel-switcher select { font-size: 14px; }
.app-shell .disconnect-button { font-size: 14px; }
.app-shell .room-eyebrow { font-size: 12.5px; }
.app-shell .live-pill { font-size: 11.25px; }
.app-shell .room-hero h1 { font-size: 32.5px; }
.app-shell .room-hero p { font-size: 15px; }
.app-shell .room-stats { font-size: 12.5px; }
.app-shell .section-kicker, .app-shell .section-counter { font-size: 12.5px; }
.app-shell .section-heading h2 { font-size: 25px; }
.app-shell .voice-card > strong { font-size: 15px; }
.app-shell .voice-card > span { font-size: 12.5px; }
.app-shell .more-count { font-size: 17.5px; }
.app-shell .voice-empty { font-size: 13.75px; }
.app-shell .chat-empty strong { font-size: 15px; }
.app-shell .chat-empty span { font-size: 12.5px; }
.app-shell .message-meta strong { font-size: 13.75px; }
.app-shell .message-meta time { font-size: 11.25px; }
.app-shell .message-bubble, .app-shell .message-composer input { font-size: 15px; }
.app-shell .dock-user strong { font-size: 13.75px; }
.app-shell .dock-user span, .app-shell .mic-mode-switch button, .app-shell .ptt-indicator { font-size: 11.25px; }
.app-shell .member-panel-heading h2 { font-size: 23.75px; }
.app-shell .member-search input { font-size: 13.75px; }
.app-shell .member-channel-heading span { font-size: 15px; }
.app-shell .member-channel-heading small { font-size: 12.5px; }
.app-shell .member-copy strong { font-size: 12.5px; }
.app-shell .member-copy span, .app-shell .channel-no-members { font-size: 11.25px; }
.app-shell .member-empty, .app-shell .member-panel-tip { font-size: 12.5px; }
.settings-modal .settings-header h2 { font-size: 27.5px; }
.settings-modal .settings-section h3 { font-size: 20px; }
.settings-modal .settings-label, .settings-modal .settings-range-row strong, .settings-modal .settings-error { font-size: 12.5px; }
.settings-modal .settings-select { font-size: 13.75px; }
.settings-modal .mic-test-header strong { font-size: 13.75px; }
.settings-modal .mic-test-header button { font-size: 12.5px; }
.settings-modal .meter-labels { font-size: 10px; }
.settings-modal .mode-note { font-size: 12.5px; }
.join-page .brand-lockup strong { font-size: 22.5px; }
.join-page .brand-lockup small, .join-page .header-note { font-size: 12.5px; }
.join-page .language-switch { font-size: 12.5px; }
.join-page .eyebrow { font-size: 13.75px; }
.join-page .join-copy h1 { font-size: clamp(52px, 6.6vw, 90px); }
.join-page .join-description { font-size: 21.25px; }
.join-page .promise-item b { font-size: 15px; }
.join-page .promise-item small { font-size: 12.5px; }
.join-page .card-kicker { font-size: 12.5px; }
.join-page .join-card h2 { font-size: 33.75px; }
.join-page .card-lead { font-size: 16.25px; }
.join-page .notice { font-size: 15px; }
.join-page .field-label { font-size: 13.75px; }
.join-page .field-wrap input { font-size: 16.25px; }
.join-page .primary-button { font-size: 15px; }
.join-page .connect-button { font-size: 16.25px; }
.join-page .join-meta, .join-page .join-footer { font-size: 12.5px; }

@media (min-width: 741px) and (max-width: 980px) { .app-shell { grid-template-columns: minmax(0, 1fr); }.member-panel { display: none; } }
@media (max-width: 980px) { .app-shell { display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) minmax(210px, 35dvh); }.workspace { height: auto; min-height: 0; }.member-panel { display: flex; border-top: 1px solid #eef2f0; border-left: 0; padding: 16px 18px; }.member-tree { margin-top: 10px; } }
@media (max-width: 740px) { .app-shell { display: grid; grid-template-rows: minmax(0, 1fr) 220px; }.channel-switcher { max-width: 150px; }.channel-switcher select { max-width: 112px; }.app-shell .room-hero h1 { font-size: 27.5px; }.app-shell .room-hero p { font-size: 13.75px; }.app-shell .section-heading h2 { font-size: 21.25px; }.app-shell .message-bubble, .app-shell .message-composer input { font-size: 13.75px; }.app-shell .mic-mode-switch button { font-size: 11.25px; }.settings-modal .settings-content { padding: 24px 20px; }.settings-modal .settings-header h2 { font-size: 23.75px; } }

/* Keep the connected workspace sized to the browser viewport and let the
   workspace and member tree own their scroll areas when the window shrinks. */
:global(html), :global(body), :global(#app) { width: 100%; height: 100dvh; min-height: 0; max-height: 100dvh; }
:global(body) { overflow-x: hidden; overflow-y: auto; }
.web-client { height: 100dvh; min-height: 0; max-height: 100dvh; }
.web-client { overflow: hidden; }
.join-page { height: 100dvh; min-height: 0; overflow-y: auto; }
.app-shell { grid-template-columns: 318px minmax(0, 1fr); height: 100dvh; min-height: 0; max-height: 100dvh; }
.workspace { grid-column: 2; grid-row: 1; min-height: 0; height: 100%; }
.workspace-scroll { min-height: 0; padding-bottom: env(safe-area-inset-bottom, 0px); }
.member-panel { grid-column: 1; grid-row: 1; border-right: 1px solid #eef2f0; border-left: 0; }
.voice-avatar.speaking { box-shadow: 0 0 0 3px #90f691, 0 0 14px rgba(144,246,145,.48); }
.chat-panel { min-height: 0; }
.message-list { min-height: clamp(150px, 20dvh, 220px); max-height: min(360px, 42dvh); }
.workspace-content { padding-bottom: 64px; }

@media (max-width: 980px) {
  .app-shell { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) minmax(210px, 35dvh); }
  .workspace { grid-column: 1; grid-row: 1; height: auto; }
  .member-panel { grid-column: 1; grid-row: 2; display: flex; border-top: 1px solid #eef2f0; border-right: 0; padding: 16px 18px; }
}

@media (max-width: 740px) {
  .app-shell { grid-template-rows: minmax(0, 1fr) 220px; }
}

/* Desktop audio controls live in the member rail so the workspace header
   stays focused on navigation. Mobile keeps its existing controls below the
   voice cards and in the More panel. */
.header-tools { align-items: center; }
.header-action, .round-icon { line-height: 0; }
.guide-button { display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 10px; color: #006a64; background: #edf7f4; border: 1px solid #d7ebe6; border-radius: 8px; font-size: 12px; font-weight: 700; text-decoration: none; cursor: pointer; }
.guide-button:hover { color: #fff; background: #006a64; border-color: #006a64; }
.workspace-actions { align-items: center; flex-wrap: nowrap; }
.workspace-actions .header-action { flex: 0 0 34px; padding: 0; line-height: 0; }
.workspace-actions .header-action .ui-icon { margin: 0; }
.desktop-audio-dock { display: flex; align-items: center; gap: 9px; flex: 0 0 auto; min-width: 0; margin-top: 12px; padding: 9px; color: var(--text-muted); background: color-mix(in srgb, var(--accent) 8%, var(--surface-1)); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 8px 20px color-mix(in srgb, var(--text-primary) 10%, transparent); }
.desktop-audio-dock-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 3px; }
.desktop-audio-dock-copy strong { overflow: hidden; color: var(--text-primary); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.desktop-audio-dock-copy span { overflow: hidden; font-size: 10px; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
.desktop-audio-dock-actions { display: flex; align-items: center; gap: 4px; flex: 0 0 auto; }
.dock-audio-button { display: grid; place-items: center; width: 34px; height: 34px; padding: 0; color: var(--text-muted); background: transparent; border: 1px solid transparent; border-radius: 9px; cursor: pointer; transition: color .16s, background .16s, border-color .16s, transform .16s; }
.dock-audio-button:hover, .dock-audio-button:focus-visible { color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, var(--surface-1)); border-color: color-mix(in srgb, var(--accent) 32%, var(--border)); transform: translateY(-1px); }
.dock-audio-button.microphone-header-toggle.muted { color: var(--danger); background: color-mix(in srgb, var(--danger) 12%, var(--surface-1)); }
.dock-audio-button.accompaniment-toggle.active { color: var(--accent); background: color-mix(in srgb, var(--accent) 18%, var(--surface-1)); border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent); }
.settings-mode-switch { width: fit-content; margin: 0 0 7px; }
.settings-hint { margin: -1px 0 19px; color: #8b9994; font-size: 11px; }

@media (max-width: 740px) {
  .header-tools { gap: 7px; }
  .header-note, .github-button span, .qq-button .qq-label, .changelog-button span, .guide-button span { display: none; }
  .github-button { width: 34px; justify-content: center; padding: 0; }
  .qq-button { width: 32px; min-width: 32px; min-height: 32px; justify-content: center; padding: 0; }
  .changelog-button { width: 32px; min-width: 32px; min-height: 32px; padding: 0; }
  .guide-button { width: 32px; justify-content: center; padding: 0; }
}
.chat-tabs { display: flex; align-items: center; gap: 6px; max-width: 100%; margin-top: 18px; overflow-x: auto; padding-bottom: 3px; }
.chat-tabs button { display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto; padding: 7px 10px; color: #74837e; background: #f3f7f5; border: 1px solid transparent; border-radius: 7px; font-size: 11px; cursor: pointer; }
.chat-tabs button:hover { color: #006a64; background: #e8f4f1; }
.chat-tabs button.active { color: #006a64; background: #dff1ed; border-color: #c9e5df; font-weight: 700; }
.event-row { display: flex; align-items: baseline; gap: 12px; padding: 9px 10px; color: #65746e; border-bottom: 1px solid #edf2f0; font-size: 12px; line-height: 1.45; }
.event-row time { flex: 0 0 auto; color: #99a6a1; font-size: 10px; }
.member-panel-heading { align-items: flex-end; }
.status-button { display: inline-flex; align-items: center; gap: 6px; padding: 6px 8px; color: #5f746c; background: #f2f7f5; border: 1px solid #e0ebe7; border-radius: 7px; font-size: 11px; cursor: pointer; }
.status-button:hover, .status-button.active { color: #8c653a; background: #fcf3e7; border-color: #f0dcc0; }
.status-dot { width: 7px; height: 7px; border-radius: 50%; background: #66d27a; }
.status-button.active .status-dot { background: #e0a34d; }
.member-row { position: relative; padding: 4px 6px; margin: -4px -6px; border-radius: 9px; transition: background .16s ease, box-shadow .16s ease; }
.member-row:hover, .member-row:focus-within { background: #edf7f4; box-shadow: 0 4px 12px rgba(20, 58, 51, .07); }
.member-context-menu { position: fixed; z-index: 40; display: grid; min-width: 188px; gap: 3px; padding: 8px; background: #fff; border: 1px solid #e0eae6; border-radius: 10px; box-shadow: 0 14px 35px rgba(20, 50, 44, .16); }
.member-context-menu strong { padding: 4px 8px 7px; color: #2a3934; font-size: 12px; }
.member-context-menu button { display: flex; align-items: center; gap: 8px; padding: 8px; color: #52625c; background: transparent; border-radius: 6px; font-size: 11px; text-align: left; cursor: pointer; }
.member-context-menu button:hover { color: #006a64; background: #edf6f3; }
.menu-volume { display: grid; gap: 6px; padding: 4px 8px 8px; color: #71817c; font-size: 10px; }
.menu-volume input { width: 100%; height: 5px; appearance: none; border-radius: 99px; outline: none; cursor: pointer; }
.menu-volume input::-webkit-slider-thumb { width: 14px; height: 14px; appearance: none; border: 2px solid #81d8d0; border-radius: 50%; background: #fff; cursor: pointer; }
.menu-volume input::-moz-range-thumb { width: 14px; height: 14px; border: 2px solid #81d8d0; border-radius: 50%; background: #fff; cursor: pointer; }
.poke-banner { position: fixed; z-index: 35; top: 82px; right: 24px; display: flex; align-items: center; gap: 9px; max-width: min(380px, calc(100% - 48px)); padding: 10px 11px; color: #52645c; background: #fffdf6; border: 1px solid #f0dfbd; border-radius: 9px; box-shadow: 0 8px 22px rgba(88, 65, 28, .12); font-size: 12px; }
.poke-banner > .ui-icon { color: #d2973d; }
.poke-banner span { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.poke-banner strong { color: #8f6532; }
.poke-banner small { font-size: inherit; }
.poke-banner button { display: grid; place-items: center; padding: 3px; color: #9b8a6e; background: transparent; border-radius: 5px; cursor: pointer; }
.poke-banner button:hover { color: #735020; background: #f9eed9; }
.audio-diagnostic, .audio-level-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 10px; color: #7b8a85; font-size: 11px; }
.audio-diagnostic strong, .audio-level-row strong { color: #3c625b; font-size: 11px; }
.permission-denied { color: #b3514b !important; }
.permission-granted { color: #2d8547 !important; }
.audio-level-track { height: 7px; margin: 7px 0 17px; overflow: hidden; background: #e8efec; border-radius: 999px; }
.audio-level-track i { display: block; height: 100%; min-width: 0; background: linear-gradient(90deg, #69c8bb, #58d675); border-radius: inherit; transition: width .08s linear; }
.test-audio { display: block; width: 100%; height: 34px; margin-top: 11px; }

/* M008 semantic theme tokens and keyboard-safe surfaces. */
:global(:root) { color-scheme: light; --surface-0: #f7f9f8; --surface-1: #fff; --surface-2: #f1f6f4; --text-primary: #192120; --text-muted: #71807c; --border: #e4ece9; --accent: #006a64; --success: #65d879; --warning: #c89143; --danger: #c95a54; }
:global(:root[data-theme="dark"]) { color-scheme: dark; --surface-0: #101918; --surface-1: #172321; --surface-2: #202f2c; --text-primary: #e8f3f0; --text-muted: #9bb0aa; --border: #30413d; --accent: #69d2c7; --success: #78e489; --warning: #e2b36c; --danger: #ee8a82; }
@media (prefers-color-scheme: dark) { :global(:root[data-theme="system"]) { color-scheme: dark; --surface-0: #101918; --surface-1: #172321; --surface-2: #202f2c; --text-primary: #e8f3f0; --text-muted: #9bb0aa; --border: #30413d; --accent: #69d2c7; --success: #78e489; --warning: #e2b36c; --danger: #ee8a82; } }
.web-client { background: var(--surface-0); color: var(--text-primary); }
.join-page { background-color: var(--surface-0); color: var(--text-primary); }
.join-page .join-card { position: relative; }
.app-shell, .workspace { background: var(--surface-1); }
.workspace-header, .member-panel, .voice-card, .settings-modal { background: var(--surface-1); border-color: var(--border); }
.workspace-header { border-bottom-color: var(--border); }
.workspace-content { color: var(--text-primary); }
.join-card { background: color-mix(in srgb, var(--surface-1) 92%, transparent); border-color: var(--border); }
.field-wrap, .message-composer, .member-search, .mic-mode-switch, .mode-note { background: var(--surface-2); }
.field-wrap input, .message-composer input, .member-search input, .settings-select { color: var(--text-primary); }
.room-hero { background: linear-gradient(110deg, color-mix(in srgb, var(--accent) 18%, var(--surface-1)), var(--surface-1) 75%); }
.voice-card, .member-panel, .settings-modal { box-shadow: 0 7px 18px color-mix(in srgb, var(--text-primary) 8%, transparent); }
.section-heading h2, .room-hero h1, .join-card h2, .member-panel-heading h2, .message-meta strong, .member-copy strong { color: var(--text-primary); }
.section-kicker, .card-kicker, .settings-label, .header-note, .section-counter, .message-meta time, .member-copy span, .chat-empty, .join-description, .card-lead { color: var(--text-muted); }
.chat-panel, .chat-heading, .settings-header, .settings-footer, .settings-separator { border-color: var(--border); }
.message-bubble { color: var(--text-primary); background: var(--surface-2); }
.settings-content, .settings-nav { background: var(--surface-1); }
.settings-nav { border-right-color: var(--border); }
.settings-section h3, .settings-header h2 { color: var(--text-primary); }
 .settings-select, .language-select { background: var(--surface-2); border-color: var(--border); color: var(--text-primary); }
.audio-level-track, .meter i { background: var(--border); }
.member-presence { border-color: var(--surface-1); }
.member-row:hover, .member-row:focus-within { background: color-mix(in srgb, var(--accent) 10%, var(--surface-1)); box-shadow: 0 4px 12px color-mix(in srgb, var(--text-primary) 8%, transparent); }
:global(button:focus-visible), :global(a:focus-visible), :global(input:focus-visible), :global(select:focus-visible), :global(textarea:focus-visible) { outline: 3px solid color-mix(in srgb, var(--accent) 55%, transparent); outline-offset: 2px; }
.message-composer { position: sticky; bottom: env(safe-area-inset-bottom, 0px); z-index: 3; }
@media (max-width: 740px) { .workspace-scroll { overscroll-behavior: contain; }.workspace-content { width: min(100% - 24px, 650px); padding-bottom: calc(24px + env(safe-area-inset-bottom, 0px)); }.message-composer { margin-bottom: 8px; } }
@media (max-width: 740px) { .member-context-menu { left: 12px !important; right: 12px; top: auto !important; bottom: env(safe-area-inset-bottom, 0px); min-width: 0; border-radius: 16px 16px 0 0; padding: 14px; } .member-context-menu button { min-height: 42px; font-size: 13px; } .member-context-menu strong { padding: 4px 8px 11px; font-size: 14px; } .menu-volume { font-size: 12px; } }

:global(html[data-theme="dark"] .join-page .brand-lockup strong) { color: var(--accent); }
:global(html[data-theme="dark"] .join-page .brand-lockup strong span) { color: var(--text-primary); }
:global(html[data-theme="dark"] .join-page .brand-lockup small),
:global(html[data-theme="dark"] .join-page .header-note),
:global(html[data-theme="dark"] .join-page .join-description),
:global(html[data-theme="dark"] .join-page .promise-item small),
:global(html[data-theme="dark"] .join-page .card-lead),
:global(html[data-theme="dark"] .join-page .field-hint),
:global(html[data-theme="dark"] .join-page .join-meta),
:global(html[data-theme="dark"] .join-page .join-footer) { color: var(--text-muted); }
:global(html[data-theme="dark"] .join-page .join-copy h1),
:global(html[data-theme="dark"] .join-page .join-card h2),
:global(html[data-theme="dark"] .join-page .promise-item b),
:global(html[data-theme="dark"] .join-page .field-label) { color: var(--text-primary); }
:global(html[data-theme="dark"] .join-page .join-copy h1 em),
:global(html[data-theme="dark"] .join-page .eyebrow),
:global(html[data-theme="dark"] .join-page .card-kicker),
:global(html[data-theme="dark"] .join-page .field-label span),
:global(html[data-theme="dark"] .join-page .join-footer a) { color: var(--accent); }
:global(html[data-theme="dark"] .join-page .join-card) { background: color-mix(in srgb, var(--surface-1) 94%, transparent); border-color: var(--border); box-shadow: 0 20px 52px color-mix(in srgb, var(--text-primary) 14%, transparent); }
:global(html[data-theme="dark"] .join-page .field-wrap) { color: var(--text-muted); background: var(--surface-2); }
:global(html[data-theme="dark"] .join-page .field-wrap input) { color: var(--text-primary); }
:global(html[data-theme="dark"] .join-page .qq-modal-card) { color: var(--text-primary); border-color: var(--border); background: var(--surface-1); box-shadow: 0 20px 60px color-mix(in srgb, var(--text-primary) 18%, transparent); }
:global(html[data-theme="dark"] .join-page .qq-modal-heading h2) { color: var(--text-primary); }
:global(html[data-theme="dark"] .join-page .qq-direct-join) { color: var(--text-muted); }
:global(html[data-theme="dark"] .join-page .qq-modal-close) { color: var(--text-muted); background: var(--surface-2); border-color: var(--border); }
:global(html[data-theme="dark"] .join-page .qq-join-link) { color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, var(--surface-2)); border-color: color-mix(in srgb, var(--accent) 30%, var(--border)); }
:global(html[data-theme="dark"] .join-page .qq-join-link:hover) { color: var(--surface-1); background: var(--accent); border-color: var(--accent); }
:global(html[data-theme="dark"] .join-page .field-wrap input::placeholder) { color: var(--text-muted); }
:global(html[data-theme="dark"] .join-page .join-footer) { border-top-color: var(--border); }

/* M007 whisper target controls and M008 mobile navigation. */
.whisper-strip { display: flex; align-items: center; gap: 12px; margin-top: 18px; padding: 12px 14px; color: #52645e; border: 1px solid #d6ebe5; border-radius: 10px; background: #eef8f5; }
.whisper-strip-copy { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
.whisper-strip-copy strong { display: inline-flex; align-items: center; gap: 6px; color: #006a64; font-size: 12px; white-space: nowrap; }
.whisper-strip-copy span { overflow: hidden; color: #71837d; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.whisper-ptt-button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 36px; padding: 0 12px; color: #fff; background: #006a64; border-radius: 8px; font-size: 12px; font-weight: 700; cursor: pointer; touch-action: none; user-select: none; }
.whisper-ptt-button.active { background: #2f9d5c; box-shadow: 0 0 0 4px rgba(47,157,92,.16); }
.mobile-nav, .mobile-more-panel { display: none; }
.mobile-section-hidden { display: block; }

@media (min-width: 741px) {
  .app-shell .mobile-section-hidden { display: block; }
}

@media (max-width: 740px) {
  .app-shell { display: flex; flex-direction: column; height: auto; min-height: 100dvh; max-height: none; padding-bottom: calc(68px + env(safe-area-inset-bottom, 0px)); overflow: visible; }
  .app-shell .workspace { display: flex; flex: 1 1 auto; height: calc(100dvh - 61px); min-height: 0; }
  .app-shell .workspace-scroll { flex: 1; height: 100%; min-height: 0; overflow-y: auto; }
  .app-shell .mobile-section-hidden { display: none; }
  .app-shell.mobile-view-more .workspace { display: none; }
  .app-shell .member-panel { display: none !important; order: 2; width: 100%; max-height: calc(100dvh - 142px); min-height: 235px; padding: 18px 15px 24px; border-top: 1px solid var(--border); border-right: 0; overflow: hidden; }
  .app-shell .member-panel.mobile-section-visible { display: flex !important; }
  .app-shell .member-panel .member-tree { max-height: none; }
  .mobile-more-panel { display: grid; gap: 10px; width: min(100% - 30px, 650px); margin: 26px auto 0; padding: 20px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface-1); box-shadow: 0 7px 18px color-mix(in srgb, var(--text-primary) 8%, transparent); }
  .mobile-more-panel h2 { margin: 0 0 8px; color: var(--text-primary); font-size: 24px; }
  .mobile-more-panel button { display: flex; align-items: center; gap: 10px; min-height: 46px; padding: 0 12px; color: var(--text-primary); background: var(--surface-2); border: 1px solid var(--border); border-radius: 9px; text-align: left; cursor: pointer; }
  .mobile-more-panel button:hover { color: var(--accent); border-color: var(--accent); }
  .mobile-more-panel button.danger { color: var(--danger); }
  .mobile-nav { position: fixed; z-index: 30; right: 0; bottom: 0; left: 0; display: grid; grid-template-columns: repeat(4, 1fr); gap: 2px; min-height: 68px; padding: 6px 8px calc(6px + env(safe-area-inset-bottom, 0px)); background: color-mix(in srgb, var(--surface-1) 94%, transparent); border-top: 1px solid var(--border); box-shadow: 0 -7px 20px color-mix(in srgb, var(--text-primary) 8%, transparent); backdrop-filter: blur(14px); }
  .mobile-nav button { display: grid; place-items: center; gap: 3px; min-width: 0; color: var(--text-muted); background: transparent; border-radius: 8px; font-size: 11px; cursor: pointer; }
  .mobile-nav button.active { color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); font-weight: 700; }
  .mobile-nav button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .whisper-strip { align-items: stretch; flex-wrap: wrap; gap: 8px; }
  .whisper-strip-copy { width: 100%; flex: 1 0 100%; }
  .whisper-ptt-button { flex: 1; min-height: 46px; }
  .whisper-strip > .text-button { min-height: 38px; }
}

/* Keep the desktop join card comfortable without making the welcome page
   taller than the browser. Smaller viewports can scroll inside the card. */
@media (min-width: 741px) {
  .join-header { min-height: 72px; }
  .join-content { padding: 28px 0 36px; }
  .join-card { max-height: calc(100dvh - 190px); overflow-y: auto; }
  .join-footer { min-height: 54px; }
}

@media (max-width: 740px) {
  .join-card { max-height: none; overflow: visible; }
}

/* The document itself never becomes the scroll surface. Each view owns its
   content scroll area so headers, controls and mobile navigation stay fixed. */
:global(html), :global(body), :global(#app) { width: 100%; height: 100dvh; min-height: 0; max-height: 100dvh; overflow: hidden; }
.join-page { height: 100dvh; min-height: 0; overflow: hidden; }
.join-content { min-height: 0; }

@media (max-width: 740px) {
  .join-content { overflow-y: auto; }
  .app-shell { height: 100dvh; min-height: 0; max-height: 100dvh; padding-bottom: calc(68px + env(safe-area-inset-bottom, 0px)); overflow: hidden; }
  .app-shell .workspace { height: auto; min-height: 0; flex: 1 1 auto; }
  .app-shell.mobile-view-channels .workspace { display: none; }
  .app-shell .member-panel.mobile-section-visible { flex: 1 1 auto; min-height: 0; max-height: none; }
  .mobile-more-panel { min-height: 0; max-height: none; margin-bottom: 0; overflow-y: auto; }
}

/* Match every native scroll surface to the WebSpeak palette. */
:global(*) { scrollbar-color: #8fcfc7 transparent; scrollbar-width: thin; }
:global(*::-webkit-scrollbar) { width: 8px; height: 8px; }
:global(*::-webkit-scrollbar-track) { background: transparent; }
:global(*::-webkit-scrollbar-thumb) { background: #a7d9d2; background-clip: padding-box; border: 2px solid transparent; border-radius: 999px; }
:global(*::-webkit-scrollbar-thumb:hover) { background: #6bbab1; background-clip: padding-box; border-width: 1px; }
:global(:root[data-theme="dark"] *) { scrollbar-color: #438f88 transparent; }
:global(:root[data-theme="dark"] *::-webkit-scrollbar-thumb) { background: #438f88; border-color: transparent; }
:global(:root[data-theme="dark"] *::-webkit-scrollbar-thumb:hover) { background: #69c7bc; }

/* Mobile interaction pass: keep the browser viewport fixed and give each
   mobile surface its own touch-friendly scroll area. */
.mobile-voice-controls, .voice-member-action, .member-action-button, .member-menu-backdrop { display: none; }
.microphone-header-toggle.muted { color: var(--danger); background: color-mix(in srgb, var(--danger) 12%, transparent); }
.microphone-control { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 18px; padding: 12px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 11px; }
.microphone-control .settings-label { margin-bottom: 4px; }
.microphone-control .settings-hint { max-width: 390px; margin: 0; }
.microphone-toggle { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 38px; flex: 0 0 auto; padding: 0 12px; color: #fff; background: var(--accent); border-radius: 8px; font-size: 12px; font-weight: 700; cursor: pointer; }
.microphone-toggle.muted { color: var(--danger); background: color-mix(in srgb, var(--danger) 13%, var(--surface-1)); }
.member-menu-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.member-menu-close { display: none; }

@media (max-width: 740px) {
  :global(html), :global(body), :global(#app) { height: 100%; min-height: 100%; max-height: none; }
  .web-client { height: 100dvh; height: 100svh; min-height: 100dvh; min-height: 100svh; max-height: 100dvh; max-height: 100svh; }
  .app-shell { height: 100dvh; height: 100svh; min-height: 100dvh; min-height: 100svh; max-height: 100dvh; max-height: 100svh; padding-bottom: calc(74px + env(safe-area-inset-bottom, 0px)); overflow: hidden; }
  .app-shell .workspace { height: calc(100dvh - 74px - env(safe-area-inset-bottom, 0px)); height: calc(100svh - 74px - env(safe-area-inset-bottom, 0px)); min-height: 0; max-height: calc(100dvh - 74px - env(safe-area-inset-bottom, 0px)); max-height: calc(100svh - 74px - env(safe-area-inset-bottom, 0px)); overflow: hidden; }
  .app-shell .workspace-scroll { height: 100%; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
  .workspace-header { min-height: calc(60px + env(safe-area-inset-top, 0px)); padding: env(safe-area-inset-top, 0px) 14px 0; box-sizing: border-box; position: sticky; top: 0; z-index: 6; background: color-mix(in srgb, var(--surface-1) 94%, transparent); backdrop-filter: blur(14px); }
  .breadcrumbs { flex: 1 1 auto; min-width: 0; gap: 6px; font-size: 13px; }
  .breadcrumbs .crumb-muted, .breadcrumbs > .ui-icon { display: none; }
  .mobile-brand { display: inline; font-size: 18px; }
  .workspace-actions { flex: 0 0 auto; gap: 3px; }
  .workspace-actions .header-action { width: 36px; height: 36px; flex-basis: 36px; }
  .workspace-actions .theme-toggle, .workspace-actions .workspace-language { display: none; }
  .channel-switcher { max-width: 132px; min-height: 36px; padding-inline: 9px; }
  .channel-switcher select { max-width: 92px; font-size: 12px; }
  .disconnect-button { width: 36px; height: 36px; min-height: 36px; margin-left: 0; padding: 0; justify-content: center; }
  .disconnect-button .ui-icon { display: block; margin: 0; }
  .disconnect-button span { display: none; }
  .workspace-content { display: block; width: 100%; max-width: none; min-height: 100%; margin: 0; padding: 14px 14px calc(18px + env(safe-area-inset-bottom, 0px)); box-sizing: border-box; }
  .room-hero { min-height: 152px; padding: 22px 20px; border-radius: 18px; }
  .room-hero h1 { margin-top: 14px; font-size: 25px; }
  .room-hero p { max-width: 72%; font-size: 12px; }
  .room-stats { margin-top: 15px; font-size: 11px; }
  .hero-visual { right: -28px; bottom: -2px; transform: scale(.72); transform-origin: right bottom; }
  .voice-section { margin-top: 21px; }
  .section-heading { gap: 10px; }
  .section-heading h2 { font-size: 22px; }
  .voice-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 14px; }
  .voice-card { position: relative; min-height: 136px; padding: 18px 8px 14px; border-radius: 16px; }
  .voice-avatar-wrap, .voice-avatar { width: 60px; height: 60px; }
  .voice-avatar-wrap { margin-bottom: 10px; }
  .voice-avatar { font-size: 18px; }
  .voice-status { width: 21px; height: 21px; }
  .app-shell .voice-card > strong { max-width: 100%; font-size: 14px; }
  .app-shell .voice-card > span { margin-top: 4px; font-size: 11px; }
  .voice-member-action { position: absolute; top: 7px; right: 7px; display: grid; place-items: center; width: 34px; height: 34px; color: var(--text-muted); background: color-mix(in srgb, var(--surface-2) 78%, transparent); border-radius: 10px; cursor: pointer; }
  .voice-member-action:hover, .voice-member-action:active { color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, var(--surface-1)); }
  .mobile-voice-controls { display: flex; align-items: stretch; gap: 8px; margin-top: 14px; padding: 8px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 14px; }
  .mobile-voice-toggle, .mobile-voice-settings { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 44px; min-width: 0; padding: 0 11px; color: var(--accent); background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px; font-size: 12px; font-weight: 700; cursor: pointer; }
  .mobile-voice-toggle { flex: 1 1 auto; }
  .mobile-voice-toggle.muted, .mobile-more-panel button.muted { color: var(--danger); }
  .mobile-voice-settings { flex: 0 0 auto; width: 82px; }
  .mobile-voice-settings span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .app-shell .member-panel.mobile-section-visible { display: flex !important; flex: 1 1 auto; width: 100%; height: auto; min-height: 0; max-height: none; padding: 18px 14px 16px; border-top: 0; border-right: 0; overflow: hidden; }
  .member-panel-heading { flex: 0 0 auto; }
  .member-panel-heading h2 { font-size: 23px; }
  .status-button { min-height: 34px; padding-inline: 10px; font-size: 12px; }
  .member-search { flex: 0 0 auto; min-height: 44px; margin-top: 14px; padding: 0 12px; border-radius: 11px; }
  .member-search input { font-size: 15px; }
  .app-shell .member-panel .member-tree { flex: 1 1 auto; min-height: 0; max-height: none; margin-top: 12px; padding: 0 2px 4px 0; overflow-y: auto; scrollbar-gutter: stable; }
  .member-channel-group { padding: 7px 0 12px; }
  .member-channel-heading { min-height: 44px; padding: 0 9px; border-radius: 11px; font-size: 14px; }
  .member-channel-heading small { font-size: 12px; }
  .member-list { gap: 3px; margin-top: 5px; }
  .member-row { min-height: 58px; margin: 0; padding: 7px 7px; gap: 9px; border-radius: 12px; }
  .member-avatar { width: 40px; height: 40px; border-radius: 12px; font-size: 12px; }
  .member-presence { width: 10px; height: 10px; }
  .member-copy strong { font-size: 14px; }
  .member-copy span { margin-top: 3px; font-size: 12px; }
  .desktop-audio-dock, .member-flags, .member-volume, .member-panel-tip { display: none; }
  .member-action-button { display: grid; place-items: center; width: 38px; height: 38px; flex: 0 0 38px; color: var(--text-muted); background: transparent; border-radius: 10px; cursor: pointer; }
  .member-action-button:hover, .member-action-button:active { color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, var(--surface-1)); }

  .app-shell.mobile-view-chat .workspace-scroll { overflow: hidden; }
  .app-shell.mobile-view-chat .workspace-content { display: flex; flex-direction: column; min-height: 100%; padding: 0 14px calc(8px + env(safe-area-inset-bottom, 0px)); }
  .app-shell.mobile-view-chat .chat-panel { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; margin-top: 0; padding: 0; border-top: 0; }
  .app-shell.mobile-view-chat .chat-tabs { flex: 0 0 auto; margin-top: 0; padding: 10px 0 9px; border-bottom: 1px solid var(--border); scrollbar-width: none; }
  .app-shell.mobile-view-chat .chat-tabs::-webkit-scrollbar { display: none; }
  .app-shell.mobile-view-chat .chat-heading { flex: 0 0 auto; padding: 13px 0 9px; }
  .app-shell.mobile-view-chat .chat-heading h2 { font-size: 21px; }
  .app-shell.mobile-view-chat .message-list { flex: 1 1 auto; min-height: 0; max-height: none; padding: 10px 2px 16px; overflow-y: auto; overscroll-behavior: contain; }
  .app-shell.mobile-view-chat .message-row { max-width: 94%; gap: 9px; }
  .app-shell.mobile-view-chat .message-avatar { width: 36px; height: 36px; }
  .app-shell.mobile-view-chat .message-meta strong { font-size: 12px; }
  .app-shell.mobile-view-chat .message-bubble { padding: 10px 12px; font-size: 14px; }
  .app-shell.mobile-view-chat .message-composer { position: relative; flex: 0 0 auto; min-height: 54px; margin: 0 0 4px; padding: 7px 8px 7px 13px; border: 1px solid var(--border); }
  .app-shell.mobile-view-chat .message-composer input { font-size: 14px; }

  .mobile-more-panel { width: calc(100% - 28px); max-height: none; margin: 16px auto 0; padding: 18px; border-radius: 18px; overflow-y: auto; }
  .mobile-more-panel h2 { font-size: 25px; }
  .mobile-more-panel button { min-height: 52px; font-size: 14px; }
  .mobile-nav { min-height: 74px; padding: 8px 8px calc(8px + env(safe-area-inset-bottom, 0px)); }
  .mobile-nav button { min-height: 52px; font-size: 12px; }

  .member-menu-backdrop { position: fixed; z-index: 39; inset: 0; display: block; background: rgba(13, 29, 26, .38); backdrop-filter: blur(2px); }
  .member-context-menu { z-index: 40; left: 10px !important; right: 10px; top: auto !important; bottom: calc(74px + env(safe-area-inset-bottom, 0px)) !important; min-width: 0; max-height: calc(100svh - 100px); padding: 12px; border-radius: 18px; box-shadow: 0 18px 42px rgba(13, 38, 33, .25); }
  .member-menu-header strong { padding: 4px 8px 11px; font-size: 16px; }
  .member-menu-close { display: grid; place-items: center; width: 36px; height: 36px; flex: 0 0 36px; padding: 0 !important; color: var(--text-muted); background: var(--surface-2); border-radius: 10px; }
  .member-context-menu button { min-height: 50px; padding: 8px 10px; border-radius: 10px; font-size: 14px; }
  .member-context-menu .member-menu-close { min-height: 36px; }
  .menu-volume { padding: 5px 8px 11px; font-size: 12px; }
  .menu-volume input { height: 7px; }

  .modal-backdrop { align-items: flex-end; padding: 0; }
  .settings-modal { width: 100%; max-height: calc(100svh - env(safe-area-inset-top, 0px)); border-radius: 22px 22px 0 0; }
  .qq-modal-card { width: 100%; max-height: calc(100svh - env(safe-area-inset-top, 0px)); padding: 24px 20px calc(24px + env(safe-area-inset-bottom, 0px)); border-radius: 22px 22px 0 0; }
  .qq-qr-image { width: min(100%, 330px); max-height: 52svh; }
  .settings-main { min-height: 0; overflow: hidden; }
  .settings-header { min-height: 64px; padding-inline: 18px; }
  .settings-content { min-height: 0; padding: 20px 18px; overflow-y: auto; }
  .settings-footer { min-height: 68px; padding: 8px 18px calc(8px + env(safe-area-inset-bottom, 0px)); }
  .settings-footer .save-button { min-height: 48px; }
  .microphone-control { align-items: stretch; flex-direction: column; gap: 10px; }
  .microphone-control .settings-hint { max-width: none; }
  .microphone-toggle { width: 100%; min-height: 44px; }

  .join-page { height: 100dvh; height: 100svh; min-height: 100dvh; min-height: 100svh; max-height: 100dvh; max-height: 100svh; }
  .join-header { min-height: calc(62px + env(safe-area-inset-top, 0px)); padding-top: env(safe-area-inset-top, 0px); box-sizing: border-box; }
  .join-content { align-items: stretch; justify-content: flex-start; gap: 24px; width: min(100% - 28px, 560px); padding: 24px 0 28px; overflow-y: auto; }
  .join-copy h1 { margin: 14px 0 14px; font-size: clamp(40px, 12vw, 58px); }
  .join-description { font-size: 15px; line-height: 1.65; }
  .promise-list { margin-top: 23px; }
  .join-card { padding: 22px 18px; border-radius: 18px; }
  .join-card h2 { font-size: 25px; }
  .field-grid { grid-template-columns: minmax(0, 1fr) 112px; }
  .join-footer { width: min(100% - 28px, 560px); }
}

@media (max-width: 390px) {
  .join-page .header-tools { gap: 4px; }
  .join-page .github-button, .join-page .changelog-button, .join-page .guide-button { width: 32px; min-width: 32px; min-height: 32px; height: 32px; }
  .join-page .version-badge { min-height: 32px; padding-inline: 6px; font-size: 10px; }
  .join-page .language-select { min-width: 82px; padding-inline: 6px; font-size: 11px; }
  .workspace-header { padding-inline: 10px; }
  .channel-switcher { max-width: 112px; }
  .channel-switcher select { max-width: 72px; }
  .workspace-actions .header-action { width: 32px; height: 32px; flex-basis: 32px; }
  .disconnect-button { width: 32px; height: 32px; }
  .room-hero { padding-inline: 16px; }
  .mobile-voice-settings { width: 56px; padding-inline: 4px; }
  .mobile-voice-toggle { flex: 0 0 44px; padding-inline: 0; }
  .mobile-voice-toggle span { display: none; }
  .mobile-voice-settings span { display: none; }
  .join-content { gap: 18px; }
  .join-card { padding-inline: 15px; }
}

/* Keep every welcome-page action inside the viewport on narrow phones. */
@media (max-width: 420px) {
  .join-page .join-header { width: calc(100% - 20px); gap: 6px; }
  .join-page .brand-lockup { min-width: 0; flex: 1 1 auto; gap: 7px; }
  .join-page .brand-mark { width: 32px; height: 32px; border-radius: 9px; }
  .join-page .brand-lockup strong { overflow: hidden; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
  .join-page .brand-lockup small { display: none; }
  .join-page .header-tools { min-width: 0; flex: 0 0 auto; gap: 2px; }
  .join-page .header-tools .theme-toggle { display: none; }
  .join-page .github-button, .join-page .bilibili-button, .join-page .changelog-button, .join-page .guide-button { width: 28px; min-width: 28px; min-height: 28px; height: 28px; padding: 0; }
  .join-page .github-button, .join-page .bilibili-button, .join-page .changelog-button, .join-page .guide-button { justify-content: center; }
  .join-page .github-button .ui-icon { width: 16px; height: 16px; }
  .join-page .bilibili-glyph { width: 18px; height: 18px; }
  .join-page .version-badge { min-width: 28px; min-height: 28px; padding-inline: 4px; font-size: 9px; }
  .join-page .language-select { min-width: 76px; min-height: 28px; padding-inline: 4px; font-size: 10px; }
}

@media (max-width: 360px) {
  .join-page .brand-lockup > div { display: none; }
  .join-page .brand-lockup { flex: 0 0 32px; }
}

.bilibili-button { display: inline-flex; align-items: center; gap: 7px; min-height: 30px; padding: 0 10px; color: #e56b91; background: #fff0f5; border: 1px solid #f6d2df; border-radius: 8px; font-size: 11px; font-weight: 800; text-decoration: none; transition: .18s; }
.bilibili-button:hover { color: #fff; background: #e56b91; border-color: #e56b91; box-shadow: 0 7px 16px rgba(229,107,145,.2); transform: translateY(-1px); }
.bilibili-glyph { display: grid; place-items: center; width: 18px; height: 18px; color: #fff; background: #e56b91; border-radius: 5px; font-size: 11px; line-height: 1; }
.bilibili-button:hover .bilibili-glyph { color: #e56b91; background: #fff; }

.qq-button { display: inline-flex; align-items: center; gap: 7px; min-height: 30px; padding: 0 10px; color: #1684b8; background: #eef9ff; border: 1px solid #cdeafa; border-radius: 8px; font-size: 11px; font-weight: 800; cursor: pointer; transition: .18s; }
.qq-button:hover { color: #fff; background: #168fca; border-color: #168fca; box-shadow: 0 7px 16px rgba(22,143,202,.2); transform: translateY(-1px); }
.qq-button .ui-icon { color: #168fca; }
.qq-button:hover .ui-icon { color: #fff; }

@media (max-width: 740px) {
  .bilibili-button { width: 32px; min-width: 32px; min-height: 32px; justify-content: center; padding: 0; }
  .bilibili-button .bilibili-label { display: none; }
  .qq-button { width: 32px; min-width: 32px; min-height: 32px; justify-content: center; padding: 0; }
  .qq-button .qq-label { display: none; }
}

@media (max-width: 390px) {
  .join-page .bilibili-button { width: 32px; min-width: 32px; min-height: 32px; height: 32px; }
}

/* Override the shared Bilibili sizing above for the tighter welcome header. */
@media (max-width: 420px) {
  .join-page .bilibili-button { width: 28px; min-width: 28px; min-height: 28px; height: 28px; padding: 0; }
  .join-page .qq-button { width: 28px; min-width: 28px; min-height: 28px; height: 28px; padding: 0; }
}
</style>
