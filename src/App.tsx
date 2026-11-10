import { Fragment, useEffect, useState } from "react";
import { Player } from "./components/Player";
import { Sidebar } from "./components/Sidebar";
import { Background } from "./components/ui";
import { initProxy } from "./lib/http";
import { UpdateToast } from "./components/UpdateToast";
import { PinHost } from "./lib/parental";
import { flushAllMovexa } from "./lib/scrobble";
import { installSpatialNav } from "./lib/spatial";
import { Account } from "./screens/Account";
import { CatchUp } from "./screens/CatchUp";
import { Epg } from "./screens/Epg";
import { Favorites } from "./screens/Favorites";
import { Home } from "./screens/Home";
import { Live } from "./screens/Live";
import { MediaScreen } from "./screens/Media";
import { Multi } from "./screens/Multi";
import { Profiles } from "./screens/Profiles";
import { Search } from "./screens/Search";
import { Settings } from "./screens/Settings";
import { useApp, useProfile, useScreen } from "./store/app";

export default function App() {
  const profile = useProfile();
  const screen = useScreen();
  const back = useApp((s) => s.back);
  const playing = useApp((s) => !!s.playing);
  const language = useApp((s) => s.settings.language);
  const [ready, setReady] = useState(false);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    initProxy().finally(() => setReady(true));
    flushAllMovexa();
  }, []);
  useEffect(() => installSpatialNav(back), [back]);

  if (!ready) return <Background />;

  const showProfiles = !profile || switching;
  const switchProfile = () => setSwitching(true);

  return (
    <Fragment key={language}>
      <Background dim={screen !== "home"} />
      {profile && (
        <div className="flex h-full" style={{ visibility: playing ? "hidden" : undefined }}>
        <Sidebar onProfiles={switchProfile} />
        <main key={`${profile.id}:${screen}`} className="h-full min-w-0 flex-1 animate-fade-up">
          {screen === "home" && <Home />}
          {screen === "live" && <Live />}
          {screen === "radio" && <Live radio />}
          {screen === "epg" && <Epg />}
          {screen === "vod" && <MediaScreen kind="vod" />}
          {screen === "series" && <MediaScreen kind="series" />}
          {screen === "catchup" && <CatchUp />}
          {screen === "multi" && <Multi />}
          {screen === "favorites" && <Favorites />}
          {screen === "account" && <Account onSwitchProfile={switchProfile} />}
          {screen === "settings" && <Settings />}
          {screen === "search" && <Search />}
        </main>
        </div>
      )}
      {showProfiles && <Profiles canClose={!!profile} onDone={() => setSwitching(false)} />}
      <Player />
      <PinHost />
      <UpdateToast />
    </Fragment>
  );
}
