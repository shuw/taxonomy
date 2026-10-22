import { useEffect, useState } from "react";
import poster from "../assets/hype-poster.jpg";

const VIDEO_ID = "C9giFFao2J0";

/** The one-minute video in the landing page's picture slot. Nothing is asked of YouTube until Play. */
export function HypeVideo({ onSignUp }: { onSignUp: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="video-poster" onClick={() => setOpen(true)} aria-label="Play the one-minute video">
        <img src={poster} alt="" width={1120} height={630} />
        <span className="video-play" aria-hidden="true"><svg viewBox="0 0 24 24" width="30" height="30"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg></span>
        <span className="video-label">Watch the video · 1 min</span>
      </button>
      {open && <VideoModal onClose={() => setOpen(false)} onSignUp={() => { setOpen(false); onSignUp(); }} />}
    </>
  );
}

function VideoModal({ onClose, onSignUp }: { onClose: () => void; onSignUp: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal video" role="dialog" aria-modal="true" aria-label="Taxonomy in one minute">
        <iframe src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1&rel=0`} title="Taxonomy in one minute"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
        <div className="video-actions">
          <a className="btn primary big" href="/demo">Try the demo</a>
          <button type="button" className="link" onClick={onSignUp}>or create an account</button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
