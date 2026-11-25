import express from 'express';
import crypto from 'node:crypto';
import * as webpush from 'web-push';
import { db } from '../db.js';
import { authenticateToken } from '../auth.js';

const router = express.Router();

function configureVapid() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:contato@vitatrack.app';

  if (!publicKey || !privateKey) {
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

function parseTimeToMinutes(hhmm, fallbackMinutes) {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return fallbackMinutes;
  const [h, m] = hhmm.split(':').map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) return fallbackMinutes;
  return h * 60 + m;
}

function getLocalDateAndMinutes(nowUtcMs, timezoneOffsetMinutes) {
  const offset = Number.isFinite(Number(timezoneOffsetMinutes)) ? Number(timezoneOffsetMinutes) : -180;
  const local = new Date(nowUtcMs + offset * 60 * 1000);
  const year = local.getUTCFullYear();
  const month = String(local.getUTCMonth() + 1).padStart(2, '0');
  const day = String(local.getUTCDate()).padStart(2, '0');
  const minutesOfDay = local.getUTCHours() * 60 + local.getUTCMinutes();
  return { dateStr: `${year}-${month}-${day}`, minutesOfDay };
}

// Public VAPID key for frontend subscription
router.get('/vapid-public-key', authenticateToken, (_req, res) => {
  const publicKey = process.env.VAPID_PUBLIC_KEY || null;
  const configured = Boolean(publicKey && process.env.VAPID_PRIVATE_KEY);
  return res.json({ configured, publicKey: configured ? publicKey : null });
});

// Get current water reminder settings + subscription status
router.get('/water-reminder', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    const settingsRes = await db.execute({
      sql: 'SELECT * FROM water_reminder_settings WHERE user_id = ?',
      args: [userId]
    });
    const subsRes = await db.execute({
      sql: 'SELECT COUNT(*) as total FROM push_subscriptions WHERE user_id = ?',
      args: [userId]
    });

    const row = settingsRes.rows[0];
    const devicesCount = Number(subsRes.rows[0]?.total || 0);

    return res.json({
      configured: Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
      devicesCount,
      settings: row
        ? {
            enabled: Boolean(row.enabled),
            interval_minutes: Number(row.interval_minutes) || 120,
            start_time: row.start_time || '08:00',
            end_time: row.end_time || '21:00',
            timezone_offset: Number(row.timezone_offset ?? -180)
          }
        : {
            enabled: false,
            interval_minutes: 120,
            start_time: '08:00',
            end_time: '21:00',
            timezone_offset: -180
          }
    });
  } catch (err) {
    console.error('Erro ao buscar configurações de lembrete:', err);
    return res.status(500).json({ error: 'Erro ao carregar configurações de lembrete de água.' });
  }
});

// Update water reminder settings
router.put('/water-reminder', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { enabled, interval_minutes, start_time, end_time, timezone_offset } = req.body;

  const interval = Math.max(15, Math.min(480, parseInt(interval_minutes, 10) || 120));
  const startStr = /^\d{2}:\d{2}$/.test(start_time || '') ? start_time : '08:00';
  const endStr = /^\d{2}:\d{2}$/.test(end_time || '') ? end_time : '21:00';
  const tzOffset = Number.isFinite(Number(timezone_offset)) ? Number(timezone_offset) : -180;

  try {
    await db.execute({
      sql: `INSERT INTO water_reminder_settings (user_id, enabled, interval_minutes, start_time, end_time, timezone_offset, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id) DO UPDATE SET
              enabled = excluded.enabled,
              interval_minutes = excluded.interval_minutes,
              start_time = excluded.start_time,
              end_time = excluded.end_time,
              timezone_offset = excluded.timezone_offset,
              updated_at = CURRENT_TIMESTAMP`,
      args: [userId, enabled ? 1 : 0, interval, startStr, endStr, tzOffset]
    });

    return res.json({
      message: 'Lembrete de água salvo com sucesso!',
      settings: {
        enabled: Boolean(enabled),
        interval_minutes: interval,
        start_time: startStr,
        end_time: endStr,
        timezone_offset: tzOffset
      }
    });
  } catch (err) {
    console.error('Erro ao salvar lembrete de água:', err);
    return res.status(500).json({ error: 'Erro ao salvar configurações de lembrete.' });
  }
});

// Save a Web Push subscription for this device
router.post('/subscribe', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { subscription } = req.body;

  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return res.status(400).json({ error: 'Inscrição push inválida.' });
  }

  const id = `push-${crypto.randomUUID()}`;

  try {
    await db.execute({
      sql: `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(endpoint) DO UPDATE SET
              user_id = excluded.user_id,
              p256dh = excluded.p256dh,
              auth = excluded.auth`,
      args: [id, userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth]
    });

    return res.status(201).json({ message: 'Dispositivo ativado para receber alertas de água!' });
  } catch (err) {
    console.error('Erro ao salvar inscrição push:', err);
    return res.status(500).json({ error: 'Erro ao ativar notificações neste dispositivo.' });
  }
});

// Unsubscribe a device
router.post('/unsubscribe', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { endpoint } = req.body;

  try {
    if (endpoint) {
      await db.execute({
        sql: 'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?',
        args: [userId, endpoint]
      });
    } else {
      await db.execute({
        sql: 'DELETE FROM push_subscriptions WHERE user_id = ?',
        args: [userId]
      });
    }
    return res.json({ message: 'Notificações desativadas neste dispositivo.' });
  } catch (err) {
    console.error('Erro ao remover inscrição push:', err);
    return res.status(500).json({ error: 'Erro ao desativar notificações.' });
  }
});

// Send an immediate test push notification to the user's devices
router.post('/test', authenticateToken, async (req, res) => {
  const userId = req.user.id;

  if (!configureVapid()) {
    return res.status(503).json({ error: 'Chaves VAPID ainda não configuradas no servidor.' });
  }

  try {
    const subsRes = await db.execute({
      sql: 'SELECT * FROM push_subscriptions WHERE user_id = ?',
      args: [userId]
    });

    if (subsRes.rows.length === 0) {
      return res.status(400).json({ error: 'Nenhum dispositivo inscrito. Ative as notificações primeiro.' });
    }

    const payload = JSON.stringify({
      title: 'Hora de beber água! 💧',
      body: 'Teste concluído! Seu celular está pronto para receber lembretes do VitaTrack.',
      url: '/',
      tag: 'vitatrack-water-test'
    });

    let sent = 0;
    for (const sub of subsRes.rows) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth }
          },
          payload
        );
        sent++;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await db.execute({ sql: 'DELETE FROM push_subscriptions WHERE id = ?', args: [sub.id] });
        } else {
          console.error('Erro ao enviar push de teste:', err.message);
        }
      }
    }

    if (sent === 0) {
      return res.status(400).json({ error: 'A inscrição anterior expirou. Ative as notificações novamente.' });
    }

    return res.json({ message: `Notificação de teste enviada para ${sent} dispositivo(s)!` });
  } catch (err) {
    console.error('Erro no teste de push:', err);
    return res.status(500).json({ error: 'Erro ao enviar notificação de teste.' });
  }
});

// Cron dispatcher endpoint (called every 15-30 min by cron-job.org or Vercel Cron)
async function handleDispatch(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers['authorization'] || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const querySecret = req.query.secret;

  if (cronSecret && bearer !== cronSecret && querySecret !== cronSecret) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }

  if (!configureVapid()) {
    return res.status(503).json({ error: 'Chaves VAPID não configuradas.' });
  }

  const nowMs = Date.now();
  let checked = 0;
  let sentUsers = 0;
  let sentNotifications = 0;

  try {
    const usersRes = await db.execute({
      sql: `SELECT wrs.*, us.water_goal, u.name
            FROM water_reminder_settings wrs
            JOIN users u ON u.id = wrs.user_id
            LEFT JOIN user_settings us ON us.user_id = wrs.user_id
            WHERE wrs.enabled = 1`
    });

    for (const row of usersRes.rows) {
      checked++;
      const { dateStr, minutesOfDay } = getLocalDateAndMinutes(nowMs, row.timezone_offset);
      const startMin = parseTimeToMinutes(row.start_time, 8 * 60);
      const endMin = parseTimeToMinutes(row.end_time, 21 * 60);

      // Outside configured active window
      if (minutesOfDay < startMin || minutesOfDay > endMin) {
        continue;
      }

      // Check interval (2 min grace window for cron jitter)
      const intervalMs = (Number(row.interval_minutes) || 120) * 60 * 1000;
      const lastSentMs = Number(row.last_sent_at) || 0;
      if (lastSentMs > 0 && nowMs - lastSentMs < intervalMs - 2 * 60 * 1000) {
        continue;
      }

      // Check if daily water goal is already reached
      const waterRes = await db.execute({
        sql: 'SELECT COALESCE(SUM(amount_ml), 0) as total FROM water_entries WHERE user_id = ? AND date = ?',
        args: [row.user_id, dateStr]
      });
      const totalToday = Number(waterRes.rows[0]?.total || 0);
      const goal = Number(row.water_goal) || 2500;

      if (totalToday >= goal) {
        continue;
      }

      const subsRes = await db.execute({
        sql: 'SELECT * FROM push_subscriptions WHERE user_id = ?',
        args: [row.user_id]
      });

      if (subsRes.rows.length === 0) continue;

      const remaining = Math.max(0, goal - totalToday);
      const firstName = row.name ? row.name.split(' ')[0] : '';
      const body =
        totalToday > 0
          ? `${firstName ? `${firstName}, v` : 'V'}ocê já bebeu ${totalToday} ml hoje. Faltam ${remaining} ml para sua meta!`
          : `${firstName ? `${firstName}, q` : 'Q'}ue tal tomar um copo de água agora? Sua meta diária é ${goal} ml.`;

      const payload = JSON.stringify({
        title: 'Hora de beber água! 💧',
        body,
        url: '/',
        tag: 'vitatrack-water-reminder'
      });

      let deliveredToUser = false;
      for (const sub of subsRes.rows) {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth }
            },
            payload
          );
          deliveredToUser = true;
          sentNotifications++;
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            await db.execute({ sql: 'DELETE FROM push_subscriptions WHERE id = ?', args: [sub.id] });
          } else {
            console.error(`Erro ao enviar push para ${row.user_id}:`, err.message);
          }
        }
      }

      if (deliveredToUser) {
        sentUsers++;
        await db.execute({
          sql: 'UPDATE water_reminder_settings SET last_sent_at = ? WHERE user_id = ?',
          args: [nowMs, row.user_id]
        });
      }
    }

    return res.json({
      status: 'ok',
      checked,
      sentUsers,
      sentNotifications,
      time: new Date(nowMs).toISOString()
    });
  } catch (err) {
    console.error('Erro no dispatch de notificações:', err);
    return res.status(500).json({ error: 'Erro ao processar lembretes de água.' });
  }
}

router.get('/dispatch', handleDispatch);
router.post('/dispatch', handleDispatch);

export default router;
