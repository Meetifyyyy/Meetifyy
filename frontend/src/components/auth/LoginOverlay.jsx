import { useState } from 'react';

export default function LoginOverlay({ visible, onLogin, onSwitchToSignup, toastMsg, setToastMsg }) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (user.trim() === 'sarthak' && pass.trim() === '208') {
      onLogin(user.trim());
    } else {
      setToastMsg('Invalid username or password');
    }
  };

  return (
    <div className={`overlay${visible ? ' visible' : ''}`} style={visible ? {} : { display: 'none' }}>
      <div className="auth-card">
        <h1>Welcome backk!</h1>
        <p className="subtitle">let's pick up where we left off</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input
              type="text"
              id="username"
              placeholder="Username"
              value={user}
              onChange={(e) => setUser(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              type="password"
              id="password"
              placeholder="Enter your password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
            />
          </div>
          <button type="submit" className="auth-btn">Log in</button>
        </form>
        <p className="auth-footer">
          Don't have an account? <a onClick={onSwitchToSignup}>Sign up</a>
        </p>
      </div>
    </div>
  );
}
