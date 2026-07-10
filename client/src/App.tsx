import { useState } from 'react';
import { SearchBar } from './components/SearchBar';
import { RankCard } from './components/RankCard';
import { OverviewTab } from './components/OverviewTab';
import { InsightsPanel } from './components/InsightsPanel';
import { Leaderboard } from './components/Leaderboard';
import { ComparePage } from './components/ComparePage';
import { getAccount, getMMR, ApiError, type Account, type MMR } from './lib/api';
import { parseRiotId } from './lib/parseRiotId';

type Tab = 'overview' | 'insights';
type Page = 'search' | 'compare';

function App() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [mmr, setMmr] = useState<MMR | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [page, setPage] = useState<Page>('search');

  async function loadPlayer(name: string, tag: string) {
    setLoading(true);
    setError(null);
    setAccount(null);
    setMmr(null);
    setTab('overview');

    try {
      const accountData = await getAccount(name, tag);
      const mmrData = await getMMR(name, tag, accountData.region);
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

  async function handleSearch(riotId: string) {
    const parsed = parseRiotId(riotId);
    if (!parsed) {
      setError('Enter a valid Riot ID, like Name#TAG.');
      setAccount(null);
      setMmr(null);
      return;
    }

    await loadPlayer(parsed.name, parsed.tag);
  }

  function goHome() {
    setPage('search');
    setAccount(null);
    setMmr(null);
    setError(null);
    setTab('overview');
  }

  return (
    <div className="min-h-screen bg-valorant-dark text-white">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-8 px-4 py-10 sm:px-6 lg:px-10 lg:py-16">
        {page === 'compare' ? (
          <ComparePage onBack={goHome} />
        ) : (
          <>
            <div className="flex flex-col items-center gap-8">
              <div className="text-center">
                <button
                  type="button"
                  onClick={goHome}
                  className="text-3xl font-bold tracking-tight transition hover:opacity-80"
                >
                  <span className="text-valorant-red">Track</span>ity
                </button>
                <p className="mt-1 text-sm text-zinc-500">Look up a player's current rank</p>
              </div>

              <div className="flex w-full max-w-2xl items-center justify-center gap-3">
                <SearchBar onSearch={handleSearch} loading={loading} />
                {account && (
                  <button
                    type="button"
                    onClick={goHome}
                    className="shrink-0 rounded-md border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:border-zinc-600 hover:text-white"
                  >
                    Home
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPage('compare')}
                  className="shrink-0 rounded-md border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:border-zinc-600 hover:text-white"
                >
                  Compare
                </button>
              </div>

              {loading && <p className="text-sm text-zinc-400">Searching…</p>}

              {error && !loading && (
                <div className="w-full max-w-md rounded-md border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
                  {error}
                </div>
              )}

              {!account && !loading && (
                <div className="flex w-full justify-center">
                  <Leaderboard onPlayerSelect={loadPlayer} />
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
                      mmr={mmr}
                    />
                  ) : (
                    <InsightsPanel name={account.name} tag={account.tag} region={account.region} />
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default App;
