import { useState } from 'react';
import { SearchBar } from './components/SearchBar';
import { RankCard } from './components/RankCard';
import { getAccount, getMMR, ApiError, type Account, type MMR } from './lib/api';
import { parseRiotId } from './lib/parseRiotId';

function App() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [mmr, setMmr] = useState<MMR | null>(null);

  async function handleSearch(riotId: string) {
    const parsed = parseRiotId(riotId);
    if (!parsed) {
      setError('Enter a valid Riot ID, like Name#TAG.');
      setAccount(null);
      setMmr(null);
      return;
    }

    setLoading(true);
    setError(null);
    setAccount(null);
    setMmr(null);

    try {
      const accountData = await getAccount(parsed.name, parsed.tag);
      const mmrData = await getMMR(parsed.name, parsed.tag, accountData.region);
      setAccount(accountData);
      setMmr(mmrData);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          setError('Rate limited by the Valorant API. Please wait a moment and try again.');
        } else if (err.status === 404) {
          setError('Player not found. Double check the name and tag.');
        } else {
          setError(err.message);
        }
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-valorant-dark text-white">
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-8 px-4 py-16">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="text-valorant-red">VALORANT</span> Tracker
          </h1>
          <p className="mt-1 text-sm text-zinc-500">Look up a player's current rank</p>
        </div>

        <SearchBar onSearch={handleSearch} loading={loading} />

        {loading && <p className="text-sm text-zinc-400">Searching…</p>}

        {error && !loading && (
          <div className="w-full max-w-md rounded-md border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {account && mmr && !loading && !error && <RankCard account={account} mmr={mmr} />}
      </div>
    </div>
  );
}

export default App;
