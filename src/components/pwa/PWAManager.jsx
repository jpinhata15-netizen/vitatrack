import React, { useEffect, useState } from 'react';
import { Download, RefreshCw, Share, PlusSquare, WifiOff, X, Smartphone } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Modal } from '../ui/Modal';

const INSTALL_DISMISSED_KEY = 'vitatrack_pwa_install_dismissed';

function isRunningStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

function getIOSPlatformInfo() {
  if (typeof navigator === 'undefined') {
    return { isIOS: false, isSafari: false };
  }
  const ua = navigator.userAgent || '';
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isOtherIOSBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/i.test(ua);
  const isSafari = isIOS && /Safari/i.test(ua) && !isOtherIOSBrowser;
  return { isIOS, isSafari };
}

export function PWAManager() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(() => isRunningStandalone());
  const [installDismissed, setInstallDismissed] = useState(() => {
    try {
      return localStorage.getItem(INSTALL_DISMISSED_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  const { isIOS, isSafari } = getIOSPlatformInfo();

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;

      // Checa atualizações periodicamente (a cada 60 min) sem interromper o usuário
      const intervalMs = 60 * 60 * 1000;
      setInterval(() => {
        if (navigator.onLine) {
          registration.update().catch(() => {});
        }
      }, intervalMs);

      // Checa atualizações quando o usuário retorna ao app
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible' && navigator.onLine) {
          registration.update().catch(() => {});
        }
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);
    },
    onRegisterError(error) {
      console.error('Erro ao registrar Service Worker do VitaTrack:', error);
    }
  });

  // Escuta eventos de instalação (Android / Chromium) e status de conexão
  useEffect(() => {
    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setDeferredPrompt(event);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      try {
        localStorage.removeItem(INSTALL_DISMISSED_KEY);
      } catch {
        // Ignora indisponibilidade de storage
      }
    };

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    const standaloneQuery = window.matchMedia('(display-mode: standalone)');
    const handleDisplayModeChange = (e) => {
      if (e.matches) {
        setIsInstalled(true);
        setDeferredPrompt(null);
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    if (standaloneQuery.addEventListener) {
      standaloneQuery.addEventListener('change', handleDisplayModeChange);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (standaloneQuery.removeEventListener) {
        standaloneQuery.removeEventListener('change', handleDisplayModeChange);
      }
    };
  }, []);

  const dismissInstallBanner = () => {
    setInstallDismissed(true);
    setShowIOSGuide(false);
    try {
      localStorage.setItem(INSTALL_DISMISSED_KEY, 'true');
    } catch {
      // Ignora indisponibilidade de storage
    }
  };

  const handleInstallAndroid = async () => {
    if (!deferredPrompt) return;
    try {
      deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;
      if (choiceResult?.outcome === 'accepted') {
        setIsInstalled(true);
      } else {
        dismissInstallBanner();
      }
    } catch (err) {
      console.error('Erro no fluxo de instalação:', err);
    } finally {
      setDeferredPrompt(null);
    }
  };

  const handleConfirmUpdate = () => {
    updateServiceWorker(true);
  };

  const showAndroidInstallBanner = Boolean(deferredPrompt) && !isInstalled && !installDismissed;
  const showIOSInstallBanner = isIOS && !isInstalled && !installDismissed && !showAndroidInstallBanner;

  return (
    <>
      {/* Faixa discreta de status offline */}
      {!isOnline && (
        <div className="vt-pwa-offline-bar" role="status" aria-live="polite">
          <WifiOff size={15} />
          <span>
            Sem conexão com a internet. Para consultar ou salvar registros de saúde, reconecte-se.
          </span>
        </div>
      )}

      {/* Notificação discreta de atualização disponível */}
      {needRefresh && (
        <div className="vt-pwa-banner vt-pwa-banner-update" role="alert" aria-live="polite">
          <div className="vt-pwa-banner-icon">
            <RefreshCw size={18} />
          </div>
          <div className="vt-pwa-banner-text">
            <strong>Nova versão disponível</strong>
            <span>Atualize o VitaTrack com segurança para usar a versão mais recente.</span>
          </div>
          <div className="vt-pwa-banner-actions">
            <button
              type="button"
              className="vt-btn vt-btn-ghost vt-btn-sm"
              onClick={() => setNeedRefresh(false)}
            >
              Agora não
            </button>
            <button
              type="button"
              className="vt-btn vt-btn-primary vt-btn-sm"
              onClick={handleConfirmUpdate}
            >
              Atualizar
            </button>
          </div>
        </div>
      )}

      {/* Banner discreto de instalação Android (beforeinstallprompt) */}
      {!needRefresh && showAndroidInstallBanner && (
        <div className="vt-pwa-banner" role="region" aria-label="Instalar aplicativo VitaTrack">
          <div className="vt-pwa-banner-icon">
            <Download size={18} />
          </div>
          <div className="vt-pwa-banner-text">
            <strong>Instale o VitaTrack no seu celular</strong>
            <span>Tenha sua evolução sempre à mão.</span>
          </div>
          <div className="vt-pwa-banner-actions">
            <button
              type="button"
              className="vt-btn vt-btn-primary vt-btn-sm"
              onClick={handleInstallAndroid}
            >
              Instalar aplicativo
            </button>
            <button
              type="button"
              className="vt-pwa-close-btn"
              onClick={dismissInstallBanner}
              aria-label="Dispensar aviso de instalação"
              title="Fechar"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Banner discreto de orientação para iPhone / iOS */}
      {!needRefresh && showIOSInstallBanner && (
        <div className="vt-pwa-banner" role="region" aria-label="Instalar VitaTrack no iPhone">
          <div className="vt-pwa-banner-icon">
            <Smartphone size={18} />
          </div>
          <div className="vt-pwa-banner-text">
            <strong>Instale o VitaTrack no seu celular</strong>
            <span>Tenha sua evolução sempre à mão.</span>
          </div>
          <div className="vt-pwa-banner-actions">
            <button
              type="button"
              className="vt-btn vt-btn-primary vt-btn-sm"
              onClick={() => setShowIOSGuide(true)}
            >
              Instalar aplicativo
            </button>
            <button
              type="button"
              className="vt-pwa-close-btn"
              onClick={dismissInstallBanner}
              aria-label="Dispensar aviso de instalação"
              title="Fechar"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Modal com passo a passo para iOS Safari */}
      <Modal
        isOpen={showIOSGuide}
        onClose={() => setShowIOSGuide(false)}
        title="Instalar VitaTrack no iPhone"
        maxWidth="440px"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <p style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
            No iPhone e iPad, a instalação é feita diretamente pelo Safari em poucos segundos:
          </p>

          {!isSafari && (
            <div
              style={{
                backgroundColor: 'var(--color-warning-bg)',
                color: 'var(--color-text-main)',
                borderRadius: 'var(--radius-md)',
                padding: '10px 12px',
                fontSize: '0.84rem',
                lineHeight: 1.45
              }}
            >
              <strong>Dica:</strong> parece que você não está usando o Safari. Copie o endereço deste site e abra-o no <strong>Safari</strong> para adicionar à Tela de Início.
            </div>
          )}

          <ol className="vt-ios-steps">
            <li>
              <span className="vt-ios-step-num">1</span>
              <div>
                <strong>Abra o VitaTrack no Safari</strong>
                <p>Certifique-se de estar visualizando o site no navegador Safari do iOS.</p>
              </div>
            </li>
            <li>
              <span className="vt-ios-step-num">2</span>
              <div>
                <strong>
                  Toque em Compartilhar{' '}
                  <Share size={14} style={{ verticalAlign: '-2px', color: 'var(--color-primary)' }} />
                </strong>
                <p>Use o botão de compartilhamento na barra inferior do Safari.</p>
              </div>
            </li>
            <li>
              <span className="vt-ios-step-num">3</span>
              <div>
                <strong>
                  Selecione &quot;Adicionar à Tela de Início&quot;{' '}
                  <PlusSquare size={14} style={{ verticalAlign: '-2px', color: 'var(--color-primary)' }} />
                </strong>
                <p>Role as opções do menu até encontrar esta ação.</p>
              </div>
            </li>
            <li>
              <span className="vt-ios-step-num">4</span>
              <div>
                <strong>Confirme a instalação</strong>
                <p>Toque em &quot;Adicionar&quot; no canto superior direito para criar o ícone do VitaTrack.</p>
              </div>
            </li>
          </ol>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '4px' }}>
            <button
              type="button"
              className="vt-btn vt-btn-ghost vt-btn-sm"
              onClick={dismissInstallBanner}
            >
              Não mostrar novamente
            </button>
            <button
              type="button"
              className="vt-btn vt-btn-primary vt-btn-sm"
              onClick={() => setShowIOSGuide(false)}
            >
              Entendi
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}

