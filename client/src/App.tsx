import { useState } from 'react';
import { SearchBar } from './components/SearchBar';
import { RankCard } from './components/RankCard';
import { OverviewTab } from './components/OverviewTab';
import { InsightsPanel } from './components/InsightsPanel';
import { getAccount, getMMR, ApiError, type Account, type MMR } from './lib/api';
import { parseRiotId } from './lib/parseRiotId';

type Tab = 'overview' | 'insights';

function App() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [mmr, setMmr] = useState<MMR | null>(null);
  const [tab, setTab] = useState<Tab>('overview');

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
      <div className="mx-auto flex max-w-[1500px] flex-col gap-8 px-4 py-10 sm:px-6 lg:px-10 lg:py-16">
        <div className="flex flex-col items-center gap-8">
          <div className="text-center">
            <h1 className="text-3xl font-bold tracking-tight">
              <span className="text-valorant-red">Track</span>ity
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
        </div>

        {account && mmr && !loading && !error && (
          <div className="grid w-full grid-cols-1 gap-6 lg:grid-cols-[minmax(280px,34%)_1fr] lg:items-start">
            <div className="flex flex-col gap-4">
              <RankCard account={account} mmr={mmr} />

              <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900/60 p-1">
                {(['overview', 'insights'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                      tab === t
                        ? 'bg-valorant-red/15 text-valorant-red'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {t === 'overview' ? 'Overview' : 'Insights'}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-w-0">
              {tab === 'overview' ? (
                <OverviewTab
                  key={`${account.name}#${account.tag}`}
                  name={account.name}
                  tag={account.tag}
                  region={account.region}
                />
              ) : (
                <InsightsPanel name={account.name} tag={account.tag} region={account.region} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
