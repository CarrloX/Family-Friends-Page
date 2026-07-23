import React, { useMemo } from 'react';
import { Header } from './Header';
import { UserCard } from './UserCard';
import { WinnerBanner } from './WinnerBanner';
import { VOTERS, calculateResults } from '../data/votingData';

export const SteamVotingDashboard: React.FC = () => {
  const results = useMemo(() => calculateResults(), []);

  return (
    <div className="steam-dashboard-container">
      {/* Background Steam Particles & Gradients */}
      <div className="bg-gradient-overlay"></div>
      <div className="bg-grid-lines"></div>

      <div className="dashboard-content">
        <Header />

        {/* 5 User Cards Grid */}
        <section className="voters-section">
          <div className="section-title-wrapper">
            <h2 className="section-title">
              <span className="title-icon">🎮</span> PONDERACIÓN POR INTEGRANTE (5 USUARIOS)
            </h2>
            <span className="voter-count-badge">5 / 5 Votantes Activos</span>
          </div>

          <div className="user-cards-grid">
            {VOTERS.map((voter) => (
              <UserCard key={voter.id} voter={voter} />
            ))}
          </div>
        </section>

        {/* Winner Banner & Final Leaderboard */}
        <WinnerBanner results={results} />

        {/* Footer */}
        <footer className="steam-footer">
          <p>© 2026 Steam Co-Op Game Voting • Diseñado con paleta oficial de Steam & Acentos Neón</p>
        </footer>
      </div>
    </div>
  );
};
