import React, { useEffect, useState } from 'react';
import { Bell, BellOff, Droplets, Send, Save, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

const INTERVAL_OPTIONS = [
  { value: 30, label: 'A cada 30 minutos' },
  { value: 60, label: 'A cada 1 hora' },
  { value: 90, label: 'A cada 1h 30min' },
  { value: 120, label: 'A cada 2 horas' },
  { value: 180, label: 'A cada 3 horas' }
];

export function WaterReminderPanel({ compact = false }) {
  const { token } = useAuth();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [testing, setTesting] = useState(false);

  const [serverConfigured, setServerConfigured] = useState(true);
  const [devicesCount, setDevicesCount] = useState(0);
  const [deviceSubscribed, setDeviceSubscribed] = useState(false);
  const [permission, setPermission] = useState(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );

  const [form, setForm] = useState({
    enabled: false,
    interval_minutes: 120,
    start_time: '08:00',
    end_time: '21:00'
  });

  const pushSupported =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;

  useEffect(() => {
    let active = true;
    async function load() {
      if (!token) return;
      try {
        const res = await fetch('/api/notifications/water-reminder', {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok && active) {
          const data = await res.json();
          setServerConfigured(Boolean(data.configured));
          setDevicesCount(data.devicesCount || 0);
          if (data.settings) {
            setForm({
              enabled: Boolean(data.settings.enabled),
              interval_minutes: data.settings.interval_minutes || 120,
              start_time: data.settings.start_time || '08:00',
              end_time: data.settings.end_time || '21:00'
            });
          }
        }

        if (pushSupported) {
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg && reg.pushManager) {
            const sub = await reg.pushManager.getSubscription();
            if (active) setDeviceSubscribed(Boolean(sub));
          }
        }
      } catch (err) {
        console.error('Erro ao carregar lembretes de água:', err);
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [token, pushSupported]);

  const subscribeDevice = async () => {
    if (!pushSupported) {
      showToast('Este navegador não suporta notificações Push.', 'error');
      return false;
    }

    setSubscribing(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);

      if (perm !== 'granted') {
        showToast('Permissão de notificação negada no aparelho.', 'error');
        return false;
      }

      const keyRes = await fetch('/api/notifications/vapid-public-key', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const keyData = await keyRes.json();
      if (!keyRes.ok || !keyData.configured || !keyData.publicKey) {
        setServerConfigured(false);
        showToast('Chaves VAPID ainda não configuradas no servidor.', 'error');
        return false;
      }

      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(keyData.publicKey)
        });
      }

      const subRes = await fetch('/api/notifications/subscribe', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ subscription: subscription.toJSON() })
      });

      const subData = await subRes.json();
      if (!subRes.ok) throw new Error(subData.error);

      setDeviceSubscribed(true);
      setDevicesCount((c) => Math.max(1, c));
      showToast('Alertas ativados neste celular!');
      return true;
    } catch (err) {
      console.error('Erro ao ativar push:', err);
      showToast(err.message || 'Erro ao ativar notificações neste celular.', 'error');
      return false;
    } finally {
      setSubscribing(false);
    }
  };

  const unsubscribeDevice = async () => {
    setSubscribing(true);
    try {
      let endpoint = null;
      if (pushSupported) {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager?.getSubscription();
        if (sub) {
          endpoint = sub.endpoint;
          await sub.unsubscribe();
        }
      }

      await fetch('/api/notifications/unsubscribe', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ endpoint })
      });

      setDeviceSubscribed(false);
      setDevicesCount((c) => Math.max(0, c - 1));
      showToast('Notificações desativadas neste celular.');
    } catch (err) {
      showToast(err.message || 'Erro ao desativar notificações.', 'error');
    } finally {
      setSubscribing(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      let enabledToSave = form.enabled;

      // Se ativou o lembrete mas o aparelho ainda não está inscrito, inscreve automaticamente
      if (enabledToSave && !deviceSubscribed && pushSupported && serverConfigured) {
        const ok = await subscribeDevice();
        if (!ok) {
          setSaving(false);
          return;
        }
      }

      const tzOffset = -new Date().getTimezoneOffset(); // Ex: Brasil UTC-3 = -180
      const res = await fetch('/api/notifications/water-reminder', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          enabled: enabledToSave,
          interval_minutes: Number(form.interval_minutes),
          start_time: form.start_time,
          end_time: form.end_time,
          timezone_offset: tzOffset
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast('Lembrete de água salvo com sucesso!');
    } catch (err) {
      showToast(err.message || 'Erro ao salvar lembrete.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSendTest = async () => {
    setTesting(true);
    try {
      if (!deviceSubscribed) {
        const ok = await subscribeDevice();
        if (!ok) return;
      }

      const res = await fetch('/api/notifications/test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast(data.message || 'Notificação de teste enviada!');
    } catch (err) {
      showToast(err.message || 'Erro ao enviar notificação de teste.', 'error');
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '16px 0', color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>
        Carregando configurações de lembrete...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {!compact && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--color-primary-tint)',
              color: 'var(--color-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Droplets size={19} />
          </div>
          <div>
            <h3 style={{ fontWeight: 600, fontSize: '1.05rem' }}>Lembrete de Água (Push)</h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>
              Receba alertas no celular mesmo com o VitaTrack fechado.
            </p>
          </div>
        </div>
      )}

      {!pushSupported && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 12px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--color-warning-bg)',
            color: 'var(--color-text-main)',
            fontSize: '0.84rem'
          }}
        >
          <AlertCircle size={16} color="var(--color-warning)" />
          <span>Este navegador não suporta Web Push. Use o Chrome no Android ou Safari no iOS (instalado).</span>
        </div>
      )}

      {!serverConfigured && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 12px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--color-warning-bg)',
            color: 'var(--color-text-main)',
            fontSize: '0.84rem'
          }}
        >
          <AlertCircle size={16} color="var(--color-warning)" />
          <span>Falta configurar as variáveis VAPID na Vercel para enviar notificações push.</span>
        </div>
      )}

      {permission === 'denied' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 12px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--color-danger-bg)',
            color: 'var(--color-danger)',
            fontSize: '0.84rem'
          }}
        >
          <BellOff size={16} />
          <span>Notificações bloqueadas neste navegador. Libere nas configurações do site no Chrome.</span>
        </div>
      )}

      {/* Status deste celular */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          flexWrap: 'wrap',
          padding: '12px 14px',
          borderRadius: 'var(--radius-md)',
          backgroundColor: deviceSubscribed ? 'var(--color-primary-soft)' : 'var(--color-card-muted)',
          border: '1px solid var(--color-gray-border)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {deviceSubscribed ? (
            <CheckCircle2 size={18} color="var(--color-primary)" />
          ) : (
            <Bell size={18} color="var(--color-text-secondary)" />
          )}
          <div>
            <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--color-text-main)' }}>
              {deviceSubscribed ? 'Celular conectado aos alertas' : 'Celular ainda não ativado'}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)' }}>
              {devicesCount > 0
                ? `${devicesCount} dispositivo(s) vinculado(s) à sua conta`
                : 'Ative para permitir notificações neste aparelho'}
            </div>
          </div>
        </div>

        {deviceSubscribed ? (
          <button
            type="button"
            className="vt-btn vt-btn-ghost vt-btn-sm"
            onClick={unsubscribeDevice}
            disabled={subscribing}
          >
            <BellOff size={15} /> {subscribing ? 'Aguarde...' : 'Desativar aparelho'}
          </button>
        ) : (
          <button
            type="button"
            className="vt-btn vt-btn-primary vt-btn-sm"
            onClick={subscribeDevice}
            disabled={subscribing || !pushSupported}
          >
            <Bell size={15} /> {subscribing ? 'Ativando...' : 'Ativar neste celular'}
          </button>
        )}
      </div>

      {/* Toggle principal */}
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          cursor: 'pointer',
          padding: '4px 0'
        }}
      >
        <div>
          <div style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--color-text-main)' }}>
            Enviar lembretes automáticos
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
            Os alertas param automaticamente quando você bater sua meta diária de água.
          </div>
        </div>
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => setForm((prev) => ({ ...prev, enabled: e.target.checked }))}
          style={{ width: '20px', height: '20px', accentColor: 'var(--color-primary)', cursor: 'pointer' }}
        />
      </label>

      {/* Intervalo e Horários */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
        <div className="vt-form-group" style={{ marginBottom: 0 }}>
          <label className="vt-label">Frequência</label>
          <select
            className="vt-select"
            value={form.interval_minutes}
            onChange={(e) => setForm((prev) => ({ ...prev, interval_minutes: Number(e.target.value) }))}
          >
            {INTERVAL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="vt-form-group" style={{ marginBottom: 0 }}>
          <label className="vt-label">Começar às</label>
          <input
            type="time"
            className="vt-input"
            value={form.start_time}
            onChange={(e) => setForm((prev) => ({ ...prev, start_time: e.target.value }))}
          />
        </div>

        <div className="vt-form-group" style={{ marginBottom: 0 }}>
          <label className="vt-label">Parar às</label>
          <input
            type="time"
            className="vt-input"
            value={form.end_time}
            onChange={(e) => setForm((prev) => ({ ...prev, end_time: e.target.value }))}
          />
        </div>
      </div>

      {/* Ações */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginTop: '4px' }}>
        <button
          type="button"
          className="vt-btn vt-btn-secondary vt-btn-sm"
          onClick={handleSendTest}
          disabled={testing || !pushSupported}
        >
          <Send size={14} /> {testing ? 'Enviando...' : 'Testar notificação agora'}
        </button>

        <button
          type="button"
          className="vt-btn vt-btn-primary vt-btn-sm"
          onClick={handleSave}
          disabled={saving}
        >
          <Save size={15} /> {saving ? 'Salvando...' : 'Salvar lembrete'}
        </button>
      </div>
    </div>
  );
}

