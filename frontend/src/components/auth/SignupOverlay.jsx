export default function SignupOverlay({ visible, onSwitchToLogin }) {
  return (
    <div className={`overlay${visible ? ' visible' : ''}`} style={visible ? {} : { display: 'none' }}>
      <div className="auth-card">
        <h1>join the fam</h1>
        <p className="subtitle">create your profile and get started</p>
        <form onSubmit={(e) => e.preventDefault()}>
          <div className="name-row">
            <div className="form-group">
              <label htmlFor="first">First name</label>
              <input type="text" id="first" placeholder="Alex" />
            </div>
            <div className="form-group">
              <label htmlFor="last">Last name</label>
              <input type="text" id="last" placeholder="River" />
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="signupEmail">Email</label>
            <input type="email" id="signupEmail" placeholder="you@example.com" />
          </div>
          <div className="form-group">
            <label htmlFor="signupPassword">Password</label>
            <input type="password" id="signupPassword" placeholder="Create a password" />
          </div>
          <button type="submit" className="auth-btn">Sign up</button>
        </form>
        <p className="auth-footer">
          Already have an account? <a onClick={onSwitchToLogin}>Log in</a>
        </p>
      </div>
    </div>
  );
}
