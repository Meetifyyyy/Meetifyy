export default function DashboardLayout({ wide, children }) {
  return (
    <div className={`dashboard${wide ? ' dashboard--wide' : ''}`}>
      {children}
    </div>
  );
}
