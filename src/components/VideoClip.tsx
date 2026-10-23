import { useRef, useState } from 'react';

export function VideoClip({ src, view, caption }: { src: string; view?: string; caption?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);
  const [failed, setFailed] = useState(false);
  const [slow, setSlow] = useState(false);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) {
      void v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  };
  const toggleSpeed = () => {
    const v = ref.current;
    if (!v) return;
    v.playbackRate = slow ? 1 : 0.5;
    setSlow(!slow);
  };

  return (
    <figure className="clip">
      <div className="scan">
        {failed ? (
          <div className="scan-error">This clip could not be loaded. Reload the page to try again.</div>
        ) : (
          <video
            key={src}
            ref={ref}
            className="scan-media"
            src={src}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            onError={() => setFailed(true)}
            aria-label={`Echo clip${view ? `, ${view} view` : ''}`}
          />
        )}
      </div>
      <figcaption className="clip-bar">
        <span className="scan-caption">{caption}</span>
        {!failed && (
          <span className="scan-controls">
            <button type="button" onClick={toggleSpeed} aria-pressed={slow} aria-label={slow ? 'Play at normal speed' : 'Play at half speed'}>
              {slow ? '0.5×' : '1×'}
            </button>
            <button type="button" onClick={toggle} aria-pressed={!playing}>
              {playing ? 'Pause' : 'Play'}
            </button>
          </span>
        )}
      </figcaption>
    </figure>
  );
}
