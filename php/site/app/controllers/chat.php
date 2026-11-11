<?php
// Team chat: direct messages, groups, an "everyone" channel, file sharing and read receipts.

// Plain documents only: no ZIP, and no older Office formats (.doc, .xls, .ppt) because those can carry macros.
const CHAT_FILE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'docx', 'xlsx', 'pptx', 'txt', 'csv'];
const CHAT_KINDS = ['png', 'jpg', 'gif', 'webp', 'pdf', 'docx', 'xlsx', 'pptx', 'txt', 'csv'];
const CHAT_IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp'];

function chat_iso($v): ?string
{
    $t = parse_ts($v ? (string) $v : null);
    return $t === null ? null : gmdate('Y-m-d\TH:i:s', $t) . '.000Z';
}
function chat_ext(string $name): string { return strtolower(pathinfo($name, PATHINFO_EXTENSION)); }

// Presence: remember the last time each user used the chat (at most once every 20 seconds).
function chat_touch(): void
{
    q_exec('UPDATE users SET last_seen_at = ? WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < ?)', [ts(), user()['id'], ts(time() - 20)]);
}

const CHAT_PEOPLE_SQL = 'SELECT u.id, u.email, u.last_seen_at, e.first_name, e.last_name, r.name AS role, g.title AS designation, d.name AS department
    FROM users u LEFT JOIN employees e ON e.id = u.employee_id LEFT JOIN roles r ON r.id = u.role_id
    LEFT JOIN designations g ON g.id = e.designation_id LEFT JOIN departments d ON d.id = e.department_id WHERE u.is_active = 1';

function chat_person(array $r): array
{
    $last = parse_ts($r['last_seen_at'] ? (string) $r['last_seen_at'] : null) ?? 0;
    return [
        'id' => (int) $r['id'],
        'name' => $r['first_name'] ? trim($r['first_name'] . ' ' . ($r['last_name'] ?? '')) : explode('@', (string) $r['email'])[0],
        'role' => $r['role'], 'designation' => $r['designation'] ?: null, 'department' => $r['department'] ?: null,
        'online' => (int) $r['id'] === user()['id'] || (time() - $last) < 70,
    ];
}

function chat_people(): void
{
    respond(array_map('chat_person', q_all(CHAT_PEOPLE_SQL . ' AND u.id != ? ORDER BY e.first_name, u.email', [user()['id']])));
}

function chat_conv(int $id): array
{
    $c = q_one('SELECT * FROM chat_conversations WHERE id = ?', [$id]);
    if (!$c) {
        throw new HttpError(404, 'Conversation not found');
    }
    return $c;
}
function chat_assert_member(int $convId): array
{
    $c = chat_conv($convId);
    if ($c['type'] !== 'everyone' && !q_one('SELECT 1 FROM chat_members WHERE conversation_id = ? AND user_id = ?', [$convId, user()['id']])) {
        throw new HttpError(403, 'Not permitted');
    }
    return $c;
}
function chat_ensure_everyone(): void
{
    if (q_one("SELECT id FROM chat_conversations WHERE type = 'everyone'")) {
        return;
    }
    $co = q_one('SELECT name FROM company_profile WHERE id = 1');
    q_insert('chat_conversations', ['type' => 'everyone', 'name' => (($co['name'] ?? '') ?: 'Company') . ' · Everyone', 'created_at' => ts(), 'updated_at' => ts()]);
}
function chat_mark_read(int $userId, int $convId, int $messageId): void
{
    $row = q_one('SELECT last_read_id FROM chat_reads WHERE conversation_id = ? AND user_id = ?', [$convId, $userId]);
    if (!$row) {
        q_insert('chat_reads', ['conversation_id' => $convId, 'user_id' => $userId, 'last_read_id' => $messageId]);
    } elseif ((int) $row['last_read_id'] < $messageId) {
        q_update('chat_reads', ['last_read_id' => $messageId], 'conversation_id = ? AND user_id = ?', [$convId, $userId]);
    }
}

function chat_summaries(int $userId, ?int $onlyId = null): array
{
    chat_ensure_everyone();
    $sql = "SELECT c.* FROM chat_conversations c WHERE (c.type = 'everyone' OR c.id IN (SELECT conversation_id FROM chat_members WHERE user_id = ?))";
    $p = [$userId];
    if ($onlyId) {
        $sql .= ' AND c.id = ?';
        $p[] = $onlyId;
    }
    $convs = q_all($sql, $p);
    if (!$convs) {
        return [];
    }
    $ids = array_map(fn($c) => (int) $c['id'], $convs);
    $in = marks($ids);

    $lastBy = [];
    foreach (q_all(
        "SELECT m.*, e.first_name, u.email FROM chat_messages m JOIN users u ON u.id = m.sender_id LEFT JOIN employees e ON e.id = u.employee_id
         WHERE m.id IN (SELECT MAX(id) FROM chat_messages WHERE conversation_id IN ($in) GROUP BY conversation_id)",
        $ids
    ) as $m) {
        $lastBy[(int) $m['conversation_id']] = $m;
    }

    $unreadBy = [];
    foreach (q_all(
        "SELECT m.conversation_id, COUNT(*) AS n FROM chat_messages m
         LEFT JOIN chat_reads r ON r.conversation_id = m.conversation_id AND r.user_id = ?
         WHERE m.conversation_id IN ($in) AND m.sender_id != ? AND m.deleted_at IS NULL AND m.id > COALESCE(r.last_read_id, 0)
         GROUP BY m.conversation_id",
        array_merge([$userId], $ids, [$userId]) // same order as the ? marks above: join user, conversation ids, sender
    ) as $r) {
        $unreadBy[(int) $r['conversation_id']] = (int) $r['n'];
    }

    $memberIds = [];
    foreach (q_all("SELECT conversation_id, user_id FROM chat_members WHERE conversation_id IN ($in)", $ids) as $m) {
        $memberIds[(int) $m['conversation_id']][] = (int) $m['user_id'];
    }
    $dmOthers = [];
    foreach ($convs as $c) {
        if ($c['type'] === 'direct') {
            foreach ($memberIds[(int) $c['id']] ?? [] as $u) {
                if ($u !== $userId) { $dmOthers[$u] = true; }
            }
        }
    }
    $others = [];
    if ($dmOthers) {
        foreach (q_all(CHAT_PEOPLE_SQL . ' AND u.id IN (' . marks(array_keys($dmOthers)) . ')', array_keys($dmOthers)) as $r) {
            $others[(int) $r['id']] = chat_person($r);
        }
    }
    $everyoneCount = (int) q_val('SELECT COUNT(*) FROM users WHERE is_active = 1');

    $out = [];
    foreach ($convs as $c) {
        $cid = (int) $c['id'];
        $m = $lastBy[$cid] ?? null;
        $other = null;
        if ($c['type'] === 'direct') {
            foreach ($memberIds[$cid] ?? [] as $u) {
                if ($u !== $userId) { $other = $others[$u] ?? null; break; }
            }
        }
        $out[] = [
            'id' => $cid, 'type' => $c['type'], 'name' => $other ? $other['name'] : $c['name'], 'other' => $other,
            'member_count' => $c['type'] === 'everyone' ? $everyoneCount : count($memberIds[$cid] ?? []),
            'created_by' => $c['created_by'] ? (int) $c['created_by'] : null, 'unread' => $unreadBy[$cid] ?? 0,
            'updated_at' => chat_iso($m['created_at'] ?? $c['created_at']),
            'last' => $m ? [
                'id' => (int) $m['id'], 'sender_id' => (int) $m['sender_id'], 'mine' => (int) $m['sender_id'] === $userId,
                'sender_name' => $m['first_name'] ?: explode('@', (string) $m['email'])[0], 'deleted' => (bool) $m['deleted_at'],
                'body' => $m['deleted_at'] ? null : $m['body'], 'file_name' => $m['deleted_at'] ? null : $m['file_name'], 'created_at' => chat_iso($m['created_at']),
            ] : null,
        ];
    }
    usort($out, fn($a, $b) => (parse_ts($b['updated_at'] ? substr(str_replace('T', ' ', $b['updated_at']), 0, 19) : null) ?? 0) <=> (parse_ts($a['updated_at'] ? substr(str_replace('T', ' ', $a['updated_at']), 0, 19) : null) ?? 0));
    return $out;
}

function chat_conversations(): void { respond(chat_summaries(user()['id'])); }
function chat_unread(): void { respond(['total' => array_sum(array_column(chat_summaries(user()['id']), 'unread'))]); }

function chat_create(): void
{
    $body = req_body();
    $v = new V($body);
    $type = $v->enum('type', ['direct', 'group']);
    $me = user()['id'];
    if ($type === 'direct') {
        $other = $v->int('user_id');
        $v->done();
        if ($other === $me) {
            throw new HttpError(400, 'You cannot chat with yourself');
        }
        if (!q_one('SELECT id FROM users WHERE id = ? AND is_active = 1', [$other])) {
            throw new HttpError(404, 'User not found');
        }
        $key = min($me, $other) . ':' . max($me, $other);
        $existing = q_one('SELECT id FROM chat_conversations WHERE direct_key = ?', [$key]);
        if ($existing) {
            $id = (int) $existing['id'];
        } else {
            $id = in_transaction(function () use ($key, $me, $other) {
                $cid = q_insert('chat_conversations', ['type' => 'direct', 'direct_key' => $key, 'created_by' => $me, 'created_at' => ts(), 'updated_at' => ts()]);
                q_insert('chat_members', ['conversation_id' => $cid, 'user_id' => $me, 'joined_at' => ts()]);
                q_insert('chat_members', ['conversation_id' => $cid, 'user_id' => $other, 'joined_at' => ts()]);
                return $cid;
            });
        }
    } else {
        $name = trim($v->str('name', 1, 100));
        $members = $body['member_ids'] ?? null;
        if (!is_array($members) || count($members) < 1 || count($members) > 200) {
            $v->errors[] = ['code' => 'invalid', 'path' => ['member_ids'], 'message' => 'Pick at least one person'];
        }
        $v->done();
        $ids = array_values(array_unique(array_merge([$me], array_map('intval', $members))));
        $valid = q_col('SELECT id FROM users WHERE is_active = 1 AND id IN (' . marks($ids) . ')', $ids);
        if (count($valid) < 2) {
            throw new HttpError(400, 'Pick at least one other person');
        }
        $id = in_transaction(function () use ($name, $me, $valid) {
            $cid = q_insert('chat_conversations', ['type' => 'group', 'name' => $name, 'created_by' => $me, 'created_at' => ts(), 'updated_at' => ts()]);
            foreach ($valid as $u) {
                q_insert('chat_members', ['conversation_id' => $cid, 'user_id' => (int) $u, 'joined_at' => ts()]);
            }
            return $cid;
        });
    }
    respond(chat_summaries($me, $id)[0], 201);
}

function chat_info(array $p): void
{
    $c = chat_assert_member((int) $p['id']);
    $rows = $c['type'] === 'everyone'
        ? q_all(CHAT_PEOPLE_SQL . ' ORDER BY e.first_name')
        : q_all(CHAT_PEOPLE_SQL . ' AND u.id IN (SELECT user_id FROM chat_members WHERE conversation_id = ?) ORDER BY e.first_name', [(int) $c['id']]);
    respond(['id' => (int) $c['id'], 'type' => $c['type'], 'name' => $c['name'], 'created_by' => $c['created_by'] ? (int) $c['created_by'] : null, 'members' => array_map('chat_person', $rows)]);
}

function chat_add_members(array $p): void
{
    $c = chat_assert_member((int) $p['id']);
    if ($c['type'] !== 'group') {
        throw new HttpError(400, 'Members can only be added to group chats');
    }
    $in = req_body()['user_ids'] ?? null;
    if (!is_array($in) || count($in) < 1 || count($in) > 200) {
        throw new HttpError(400, 'Validation failed', [['code' => 'invalid', 'path' => ['user_ids'], 'message' => 'Pick at least one person']]);
    }
    $ids = array_map('intval', $in);
    $valid = array_map('intval', q_col('SELECT id FROM users WHERE is_active = 1 AND id IN (' . marks($ids) . ')', $ids));
    $have = array_map('intval', q_col('SELECT user_id FROM chat_members WHERE conversation_id = ?', [(int) $c['id']]));
    $fresh = array_values(array_diff($valid, $have));
    foreach ($fresh as $u) {
        q_insert('chat_members', ['conversation_id' => (int) $c['id'], 'user_id' => $u, 'joined_at' => ts()]);
    }
    respond(['added' => count($fresh)]);
}

function chat_leave(array $p): void
{
    $c = chat_assert_member((int) $p['id']);
    if ($c['type'] !== 'group') {
        throw new HttpError(400, 'You can only leave group chats');
    }
    q_exec('DELETE FROM chat_members WHERE conversation_id = ? AND user_id = ?', [(int) $c['id'], user()['id']]);
    no_content();
}

function chat_shape(array $m, int $meId, array $readers): array
{
    $mine = (int) $m['sender_id'] === $meId;
    $readBy = 0;
    if ($mine) {
        foreach ($readers as $r) {
            if ((int) $r['user_id'] !== $meId && (int) $r['last_read_id'] >= (int) $m['id']) { $readBy++; }
        }
    }
    return [
        'id' => (int) $m['id'], 'sender_id' => (int) $m['sender_id'],
        'sender_name' => $m['first_name'] ? trim($m['first_name'] . ' ' . ($m['last_name'] ?? '')) : explode('@', (string) $m['email'])[0],
        'mine' => $mine, 'body' => $m['deleted_at'] ? null : $m['body'], 'deleted' => (bool) $m['deleted_at'],
        'file' => (!$m['deleted_at'] && $m['file_name']) ? ['name' => $m['file_name'], 'mime' => $m['file_mime'], 'size' => (int) $m['file_size'], 'image' => strpos((string) $m['file_mime'], 'image/') === 0] : null,
        'created_at' => chat_iso($m['created_at']), 'read_by' => $readBy,
    ];
}
const CHAT_MSG_SQL = 'SELECT m.*, e.first_name, e.last_name, u.email FROM chat_messages m JOIN users u ON u.id = m.sender_id LEFT JOIN employees e ON e.id = u.employee_id';

function chat_messages(array $p): void
{
    $c = chat_assert_member((int) $p['id']);
    $limit = min((int) ($_GET['limit'] ?? 60) ?: 60, 300);
    $rows = array_reverse(q_all(CHAT_MSG_SQL . ' WHERE m.conversation_id = ? ORDER BY m.id DESC LIMIT ?', [(int) $c['id'], $limit]));
    $readers = q_all('SELECT * FROM chat_reads WHERE conversation_id = ?', [(int) $c['id']]);
    $mineRead = 0;
    foreach ($readers as $r) {
        if ((int) $r['user_id'] === user()['id']) { $mineRead = (int) $r['last_read_id']; }
    }
    respond(['messages' => array_map(fn($m) => chat_shape($m, user()['id'], $readers), $rows), 'has_more' => count($rows) === $limit, 'last_read_id' => $mineRead]);
}

function chat_read(array $p): void
{
    $c = chat_assert_member((int) $p['id']);
    $last = (int) q_val('SELECT MAX(id) FROM chat_messages WHERE conversation_id = ?', [(int) $c['id']]);
    if ($last) {
        chat_mark_read(user()['id'], (int) $c['id'], $last);
    }
    no_content();
}

function chat_send(array $p): void
{
    $c = chat_assert_member((int) $p['id']);
    $v = new V(req_body());
    $text = trim($v->optStr('body', 4000) ?? '');
    $v->done();
    $file = null;
    if (!empty($_FILES['file']) && $_FILES['file']['error'] !== UPLOAD_ERR_NO_FILE) {
        $f = upload_error_check('file', 10 * 1024 * 1024, 'File is larger than 10 MB');
        if (!in_array(chat_ext($f['name']), CHAT_FILE_EXT, true)) {
            throw new HttpError(400, 'This file type is not allowed. Use images, PDF, Word, Excel, PowerPoint, TXT or CSV.');
        }
        $insp = upload_inspect($f['tmp_name'], (string) $f['name'], CHAT_KINDS);
        $file = $f;
    } elseif (empty($_FILES) && (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 0 && empty($_POST)) {
        throw new HttpError(400, 'File is larger than 10 MB');
    }
    if ($text === '' && !$file) {
        throw new HttpError(400, 'Type a message or attach a file');
    }
    $row = ['conversation_id' => (int) $c['id'], 'sender_id' => user()['id'], 'body' => $text === '' ? null : $text, 'created_at' => ts()];
    if ($file) {
        $saved = save_upload($file, 'chat/' . (int) $c['id'], $insp['ext']);
        $row += ['file_path' => $saved['rel'], 'file_name' => mb_substr($file['name'], 0, 250), 'file_mime' => $insp['mime'], 'file_size' => (int) $file['size']];
    }
    $id = q_insert('chat_messages', $row);
    q_update('chat_conversations', ['last_message_at' => ts(), 'updated_at' => ts()], 'id = ?', [(int) $c['id']]);
    chat_mark_read(user()['id'], (int) $c['id'], $id);
    respond(chat_shape(q_one(CHAT_MSG_SQL . ' WHERE m.id = ?', [$id]), user()['id'], []), 201);
}

function chat_delete(array $p): void
{
    $m = q_one('SELECT * FROM chat_messages WHERE id = ?', [(int) $p['id']]);
    if (!$m) {
        throw new HttpError(404, 'Message not found');
    }
    if ((int) $m['sender_id'] !== user()['id']) {
        throw new HttpError(403, 'You can only delete your own messages');
    }
    q_update('chat_messages', ['deleted_at' => ts(), 'body' => null, 'file_path' => null, 'file_name' => null, 'file_mime' => null, 'file_size' => null], 'id = ?', [$m['id']]);
    if ($m['file_path']) {
        @unlink(uploads_root() . '/' . $m['file_path']);
    }
    no_content();
}

function chat_file(array $p): void
{
    $m = q_one('SELECT * FROM chat_messages WHERE id = ?', [(int) $p['id']]);
    if (!$m || $m['deleted_at'] || !$m['file_path']) {
        throw new HttpError(404, 'File not found');
    }
    chat_assert_member((int) $m['conversation_id']);
    // send_stored_file() takes the type from the stored file's own extension (chosen at upload) and shows only images inline.
    send_stored_file($m['file_path'], $m['file_name'], '', true);
}
