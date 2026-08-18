// Lightweight local NetInfo shim.
// Backend sync is currently disabled, so this intentionally avoids optional
// networking imports that can break Metro resolution in dev builds.

export type NetInfoState = {
  isConnected?: boolean | null;
};

type Listener = (state: NetInfoState) => void;

type Unsubscribe = () => void;

async function getLocalNetworkState(): Promise<NetInfoState> {
  return { isConnected: true };
}

function addLocalNetworkListener(cb: Listener): Unsubscribe {
  let mounted = true;

  getLocalNetworkState().then((state) => {
    if (mounted) cb(state);
  });

  return () => {
    mounted = false;
  };
}

export const NetInfoShim = {
  async fetch(): Promise<NetInfoState> {
    return getLocalNetworkState();
  },
  
  addEventListener(cb: Listener): Unsubscribe {
    return addLocalNetworkListener(cb);
  },
};

export default NetInfoShim;
