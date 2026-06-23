import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, AlertCircle } from 'lucide-react';
import styles from './signup/SignupFlow.module.css';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!user.trim()) {
      setError('Please enter your username or email.');
      return;
    }
    if (!pass) {
      setError('Please enter your password.');
      return;
    }
    // We are mocking auth
    const success = login(user.trim(), pass);
    if (success) {
      navigate('/home');
    } else {
      setError('User not found. Please check your username or sign up.');
    }
  };

  return (
    <div className={styles.flowContainer}>
      <div className={`${styles.bgBlob} ${styles.blob1}`} />
      <div className={`${styles.bgBlob} ${styles.blob2}`} />
      
      <div className={styles.progressContainer}>
        <button onClick={() => navigate('/')} className={styles.backButton}>
          <ArrowLeft size={18} />
          Back
        </button>
      </div>

      <div className={styles.contentArea}>
        <motion.div 
          className={styles.stepWrapper}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
        >
          <h1 className={styles.headline}>Welcome back</h1>
          <p className={styles.subheadline}>Let's pick up right where we left off.</p>
          
          <form onSubmit={handleSubmit} style={{ width: '100%' }}>
            
            <input
              type="text"
              autoFocus
              className={`${styles.largeInput} ${error && !user.trim() ? styles.inputError : ''}`}
              placeholder="Username or email"
              value={user}
              onChange={(e) => {
                setUser(e.target.value);
                if (error) setError(null);
              }}
            />

            <input
              type="password"
              className={`${styles.largeInput} ${error && user.trim() && !pass ? styles.inputError : ''}`}
              placeholder="Password"
              value={pass}
              onChange={(e) => {
                setPass(e.target.value);
                if (error) setError(null);
              }}
              style={{ marginTop: '0.5rem' }}
            />

            <div style={{ minHeight: '2rem', marginTop: '0.5rem' }}>
              {error && (
                <div className={styles.errorText}><AlertCircle size={16} /> {error}</div>
              )}
            </div>

            <button type="submit" className={styles.continueBtn} disabled={!user.trim() || !pass}>
              Log in <ArrowRight className={styles.btnIcon} />
            </button>
            
            <div style={{ marginTop: '2.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.95rem', fontWeight: 500, color: '#6b7280' }}>
              <Link to="/forgot-password" style={{ color: '#6366f1', textDecoration: 'none' }}>Forgot password?</Link>
              <div>Don't have an account? <Link to="/signup" style={{ color: '#6366f1', textDecoration: 'none' }}>Sign up</Link></div>
            </div>

          </form>
        </motion.div>
      </div>
    </div>
  );
}
