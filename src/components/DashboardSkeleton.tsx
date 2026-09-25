/**
 * DashboardSkeleton
 * Skeleton loader animado que imita la estructura del dashboard
 * (header, sección de votantes con grid de tarjetas, y winner banner)
 * mientras se realiza la lectura inicial de Firestore.
 * Usa el estilo oscuro y neón de la app con animación shimmer.
 */
export const DashboardSkeleton = () => {
  // Cantidad de tarjetas skeleton; el índice como key es válido porque la lista es estática y nunca se reordena
  const skeletonCardCount = 4;

  return (
    <div className="steam-dashboard-container" aria-busy="true">
      <span className="sr-only">Cargando dashboard...</span>

      {/* Todo el contenido visual es puramente decorativo: los lectores de pantalla lo ignoran */}
      <div aria-hidden="true">
        <div className="bg-gradient-overlay"></div>
        <div className="bg-grid-lines"></div>

        <div className="dashboard-content">
        {/* ─── Header Skeleton ─── */}
        <header className="steam-header skeleton-header">
          <div className="skeleton skeleton-badge"></div>
          <div className="skeleton skeleton-title"></div>
          <div className="skeleton skeleton-subtitle"></div>
          <div className="skeleton skeleton-divider"></div>
        </header>

        {/* ─── Voters Section Skeleton ─── */}
        <section className="voters-section">
          <div className="section-title-wrapper">
            <div className="skeleton skeleton-section-title"></div>
            <div className="skeleton skeleton-section-badge"></div>
          </div>

          <div className="user-cards-grid">
            {Array.from({ length: skeletonCardCount }, (_, index) => (
              <div key={index} className="user-card skeleton-card">
                {/* Card header: avatar + name + aura */}
                <div className="card-header">
                  <div className="skeleton skeleton-avatar"></div>
                  <div className="user-meta">
                    <div className="skeleton skeleton-name"></div>
                    <div className="skeleton skeleton-aura-badge"></div>
                  </div>
                </div>

                {/* Multiplier bar */}
                <div className="skeleton skeleton-multiplier-bar"></div>

                {/* Votes list (3 items) */}
                <div className="votes-list">
                  <div className="skeleton skeleton-vote-item"></div>
                  <div className="skeleton skeleton-vote-item"></div>
                  <div className="skeleton skeleton-vote-item"></div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ─── Winner Banner Skeleton ─── */}
        <section className="winner-section">
          <div className="winner-banner-glow">
            <div className="winner-banner">
              <div className="skeleton skeleton-trophy-tag"></div>
              <div className="winner-content">
                <div className="skeleton skeleton-winner-image"></div>
                <div className="winner-details">
                  <div className="skeleton skeleton-winner-genre"></div>
                  <div className="skeleton skeleton-winner-title"></div>
                  <div className="skeleton skeleton-winner-description"></div>
                  <div className="winner-stats-grid">
                    <div className="skeleton skeleton-stat-card"></div>
                    <div className="skeleton skeleton-stat-card"></div>
                    <div className="skeleton skeleton-stat-card"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── Footer Skeleton ─── */}
        <footer className="steam-footer">
          <div className="skeleton skeleton-footer-text"></div>
        </footer>
        </div>
      </div>
    </div>
  );
};