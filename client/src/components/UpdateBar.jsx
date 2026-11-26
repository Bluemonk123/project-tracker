// When a new version of the app has been installed on the server (staging updates itself; production after a
// release), an open tab still runs the old screens. This compares the page's own script with the server's
// current one every minute and offers a reload.
import { useEffect, useState } from 'react';

const CHECK_MS = 60_000;
const currentScript = () => document.querySelector('script[type="module"][src*="/assets/index-"]')?.getAttribute('src') || null;

export default function UpdateBar() {
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    const mine = currentScript();
    if (!mine) return undefined; // development mode
    const check = async () => {
      if (document.hidden) return;
      try {
        const html = await fetch('/', { cache: 'no-store' }).then(r => (r.ok ? r.text() : ''));
        const now = (html.match(/src="(\/assets\/index-[^"]+\.js)"/) || [])[1];
        if (now && now !== mine) setFresh(true);
      } catch { /* offline: the connection badge says so */ }
    };
    const t = setInterval(check, CHECK_MS);
    document.addEventListener('visibilitychange', check);
    check();
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', check); };
  }, []);
  if (!fresh) return null;
  return (
    <div className="update-bar" role="status">
      <span>A new version of Project Tracker is available.</span>
      <button type="button" className="btn sm primary" onClick={() => window.location.reload()}>Reload</button>
      <span className="xs">Unsaved text in an open form is lost when reloading.</span>
    </div>
  );
}
