import { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { showToast } from '../utils/toast';
import { isImageUrl } from '../utils/avatar';
import Avatar from '../components/common/Avatar';
import styles from './CampusPage.module.css';
import { Share2, Plus, Search, ArrowLeft } from 'lucide-react';

const MAJORS_LIST = [
  { value: "Accounting", label: "📊 Accounting" },
  { value: "Actuarial Science", label: "📈 Actuarial Science" },
  { value: "Advertising", label: "📣 Advertising" },
  { value: "Aeronautical Engineering", label: "✈️ Aeronautical Engineering" },
  { value: "Aeronautics", label: "🛫 Aeronautics" },
  { value: "Aerospace Engineering", label: "🚀 Aerospace Engineering" },
  { value: "Agribusiness Management", label: "🚜 Agribusiness Management" },
  { value: "Agricultural Business & Technology", label: "🌾 Agricultural Business & Technology" },
  { value: "Agricultural Economics", label: "💹 Agricultural Economics" },
  { value: "Agricultural Engineering", label: "🌱 Agricultural Engineering" },
  { value: "Agricultural Operations", label: "🚜 Agricultural Operations" },
  { value: "Agriculture", label: "🌾 Agriculture" },
  { value: "Animal Sciences", label: "🐄 Animal Sciences" },
  { value: "Animation", label: "🎬 Animation" },
  { value: "Anthropology", label: "🦴 Anthropology" },
  { value: "Apparel and Textiles", label: "🧵 Apparel and Textiles" },
  { value: "Applied Communication", label: "🗣️ Applied Communication" },
  { value: "Applied Mathematics", label: "🔢 Applied Mathematics" },
  { value: "Architecture", label: "🏛️ Architecture" },
  { value: "Art", label: "🎨 Art" },
  { value: "Art & Design", label: "🎨 Art & Design" },
  { value: "Art History", label: "🏛️ Art History" },
  { value: "Artificial Intelligence", label: "🤖 Artificial Intelligence" },
  { value: "Artificial Intelligence & Data Science", label: "🧠 Artificial Intelligence & Data Science" },
  { value: "Artificial Intelligence & Machine Learning", label: "🦾 Artificial Intelligence & Machine Learning" },
  { value: "Astrophysics", label: "🌌 Astrophysics" },
  { value: "Athletic Training", label: "🏃 Athletic Training" },
  { value: "Audiology", label: "👂 Audiology" },
  { value: "Automobile Engineering", label: "🚗 Automobile Engineering" },
  { value: "Banking", label: "🏦 Banking" },
  { value: "Behavioral Sciences", label: "🧠 Behavioral Sciences" },
  { value: "Biblical Studies", label: "📖 Biblical Studies" },
  { value: "Biochemistry", label: "🔬 Biochemistry" },
  { value: "Bioinformatics", label: "🧬 Bioinformatics" },
  { value: "Biological and Biomedical Sciences", label: "🦠 Biological and Biomedical Sciences" },
  { value: "Biological and Physical Sciences", label: "🔬 Biological and Physical Sciences" },
  { value: "Biology", label: "🧬 Biology" },
  { value: "Biomedical Engineering", label: "🏥 Biomedical Engineering" },
  { value: "Biomedical Sciences", label: "🔬 Biomedical Sciences" },
  { value: "Biotechnology", label: "🧪 Biotechnology" },
  { value: "Blockchain Technology", label: "🔗 Blockchain Technology" },
  { value: "Botany", label: "🌿 Botany" },
  { value: "Business", label: "💼 Business" },
  { value: "Business Administration", label: "💼 Business Administration" },
  { value: "Business Analytics", label: "📊 Business Analytics" },
  { value: "Business, Management, and Related Support Services", label: "📊 Business, Management, and Related Support Services" },
  { value: "Cellular and Molecular Biology", label: "🧫 Cellular and Molecular Biology" },
  { value: "Chemical Engineering", label: "⚗️ Chemical Engineering" },
  { value: "Chemistry", label: "🧪 Chemistry" },
  { value: "Child Development", label: "👶 Child Development" },
  { value: "Cinematography", label: "🎥 Cinematography" },
  { value: "Civil Engineering", label: "🏗️ Civil Engineering" },
  { value: "Clinical Laboratory Science", label: "🧪 Clinical Laboratory Science" },
  { value: "Cloud Computing", label: "☁️ Cloud Computing" },
  { value: "Cognitive Science", label: "🧠 Cognitive Science" },
  { value: "Commerce", label: "💰 Commerce" },
  { value: "Communication", label: "🗣️ Communication" },
  { value: "Communication and Media Studies", label: "📡 Communication and Media Studies" },
  { value: "Communication Design", label: "📱 Communication Design" },
  { value: "Communication Sciences", label: "🗣️ Communication Sciences" },
  { value: "Community Health", label: "🏥 Community Health" },
  { value: "Community Health Services", label: "🏥 Community Health Services" },
  { value: "Community Organization and Advocacy", label: "🤝 Community Organization and Advocacy" },
  { value: "Computer and Information Sciences", label: "💻 Computer and Information Sciences" },
  { value: "Computer Applications", label: "💻 Computer Applications" },
  { value: "Computer Engineering", label: "⚙️ Computer Engineering" },
  { value: "Computer Science", label: "🖥️ Computer Science" },
  { value: "Computer Science & Engineering", label: "💻 Computer Science & Engineering" },
  { value: "Computer Software Engineering", label: "💻 Computer Software Engineering" },
  { value: "Computer Systems Networking", label: "🌐 Computer Systems Networking" },
  { value: "Conservation", label: "🌳 Conservation" },
  { value: "Construction Engineering", label: "🚧 Construction Engineering" },
  { value: "Construction Engineering Technology", label: "🏗️ Construction Engineering Technology" },
  { value: "Construction Management", label: "🏗️ Construction Management" },
  { value: "Corrections and Criminal Justice", label: "⚖️ Corrections and Criminal Justice" },
  { value: "Creative Writing", label: "✍️ Creative Writing" },
  { value: "Criminal Justice", label: "⚖️ Criminal Justice" },
  { value: "Criminal Law", label: "⚖️ Criminal Law" },
  { value: "Criminology", label: "🕵️ Criminology" },
  { value: "Cyber Law", label: "🔐 Cyber Law" },
  { value: "Cyber Security", label: "🛡️ Cyber Security" },
  { value: "Dance", label: "💃 Dance" },
  { value: "Data Analytics", label: "📈 Data Analytics" },
  { value: "Data Science", label: "📊 Data Science" },
  { value: "Dental Hygiene", label: "🦷 Dental Hygiene" },
  { value: "Dentistry", label: "🦷 Dentistry" },
  { value: "Design", label: "🎨 Design" },
  { value: "Digital Arts", label: "🎨 Digital Arts" },
  { value: "Digital Communication and Multimedia", label: "📱 Digital Communication and Multimedia" },
  { value: "Digital Marketing", label: "📱 Digital Marketing" },
  { value: "Drama", label: "🎭 Drama" },
  { value: "Early Childhood Education", label: "🧸 Early Childhood Education" },
  { value: "Earth Science", label: "🌍 Earth Science" },
  { value: "Econometrics", label: "📈 Econometrics" },
  { value: "Economics", label: "📉 Economics" },
  { value: "Education", label: "📚 Education" },
  { value: "Education (Other)", label: "📚 Education (Other)" },
  { value: "Electrical & Electronics Engineering", label: "🔌 Electrical & Electronics Engineering" },
  { value: "Electrical Engineering", label: "⚡ Electrical Engineering" },
  { value: "Electromechanical Technology", label: "⚙️ Electromechanical Technology" },
  { value: "Electronics & Communication Engineering", label: "📡 Electronics & Communication Engineering" },
  { value: "Elementary Education", label: "🏫 Elementary Education" },
  { value: "Embedded Systems", label: "🎛️ Embedded Systems" },
  { value: "Engineering", label: "⚙️ Engineering" },
  { value: "English", label: "📖 English" },
  { value: "Entrepreneurship", label: "💡 Entrepreneurship" },
  { value: "Environmental Engineering", label: "🌍 Environmental Engineering" },
  { value: "Environmental Science", label: "🌳 Environmental Science" },
  { value: "Environmental Studies", label: "🌿 Environmental Studies" },
  { value: "Event Management", label: "🎪 Event Management" },
  { value: "Exercise Physiology", label: "💪 Exercise Physiology" },
  { value: "Experimental Psychology", label: "🧠 Experimental Psychology" },
  { value: "Fashion Design", label: "👗 Fashion Design" },
  { value: "Fashion Merchandising", label: "🛍️ Fashion Merchandising" },
  { value: "Film", label: "🎬 Film" },
  { value: "Finance", label: "💵 Finance" },
  { value: "Fine Arts", label: "🎭 Fine Arts" },
  { value: "Fish and Wildlands Science and Management", label: "🐟 Fish and Wildlands Science and Management" },
  { value: "Food Science", label: "🍔 Food Science" },
  { value: "Food Technology", label: "🍔 Food Technology" },
  { value: "Foods, Nutrition, and Wellness Studies", label: "🥗 Foods, Nutrition, and Wellness Studies" },
  { value: "Foreign Languages and Literature", label: "🌐 Foreign Languages and Literature" },
  { value: "Forensic Science", label: "🔎 Forensic Science" },
  { value: "Forensic Science and Technology", label: "🔬 Forensic Science and Technology" },
  { value: "French Language and Literature", label: "🇫🇷 French Language and Literature" },
  { value: "Game Design", label: "🎮 Game Design" },
  { value: "Gender Studies", label: "⚧️ Gender Studies" },
  { value: "General Studies", label: "📚 General Studies" },
  { value: "General Studies and Humanities", label: "📚 General Studies and Humanities" },
  { value: "Geography", label: "🗺️ Geography" },
  { value: "Graphic Design", label: "🖌️ Graphic Design" },
  { value: "Health and Physical Education", label: "🏃 Health and Physical Education" },
  { value: "Health and Wellness", label: "🧘 Health and Wellness" },
  { value: "Health Care Administration", label: "🏥 Health Care Administration" },
  { value: "Health Information", label: "📋 Health Information" },
  { value: "Health Professions and Related Clinical Sciences", label: "⚕️ Health Professions and Related Clinical Sciences" },
  { value: "Health Services", label: "🏥 Health Services" },
  { value: "Health/Medical Preparatory Programs", label: "⚕️ Health/Medical Preparatory Programs" },
  { value: "History", label: "🏛️ History" },
  { value: "Hospital and Health Care Facilities Administration", label: "🏥 Hospital and Health Care Facilities Administration" },
  { value: "Hospitality Administration", label: "🏨 Hospitality Administration" },
  { value: "Hospitality Management", label: "🏨 Hospitality Management" },
  { value: "Hotel Management", label: "🏨 Hotel Management" },
  { value: "Human Development and Family Studies", label: "👨‍👩‍👧‍👦 Human Development and Family Studies" },
  { value: "Human Resource Management", label: "👥 Human Resource Management" },
  { value: "Human Resources Management", label: "👥 Human Resources Management" },
  { value: "Human Sciences (General)", label: "🧬 Human Sciences (General)" },
  { value: "Human Services", label: "🤝 Human Services" },
  { value: "Humanities", label: "📚 Humanities" },
  { value: "Illustration", label: "🖍️ Illustration" },
  { value: "Industrial Design", label: "🏭 Industrial Design" },
  { value: "Industrial Engineering", label: "⚙️ Industrial Engineering" },
  { value: "Informatics", label: "💻 Informatics" },
  { value: "Information Science", label: "ℹ️ Information Science" },
  { value: "Information Systems Security", label: "🔐 Information Systems Security" },
  { value: "Information Technology", label: "💻 Information Technology" },
  { value: "Information Technology (IT)", label: "💻 Information Technology (IT)" },
  { value: "Insurance", label: "🛡️ Insurance" },
  { value: "Interior Design", label: "🛋️ Interior Design" },
  { value: "International Business", label: "🌐 International Business" },
  { value: "International Relations", label: "🌍 International Relations" },
  { value: "International Studies", label: "🗺️ International Studies" },
  { value: "Journalism", label: "📰 Journalism" },
  { value: "Kinesiology", label: "💪 Kinesiology" },
  { value: "Language Arts Teacher Education", label: "📖 Language Arts Teacher Education" },
  { value: "Law", label: "⚖️ Law" },
  { value: "Law Enforcement Administration", label: "👮 Law Enforcement Administration" },
  { value: "Legal Assistant", label: "⚖️ Legal Assistant" },
  { value: "Legal Studies", label: "⚖️ Legal Studies" },
  { value: "Liberal Arts", label: "🎨 Liberal Arts" },
  { value: "Linguistics", label: "🗣️ Linguistics" },
  { value: "Logistics", label: "📦 Logistics" },
  { value: "Machine Learning", label: "🤖 Machine Learning" },
  { value: "Management", label: "📋 Management" },
  { value: "Management Information Systems", label: "💻 Management Information Systems" },
  { value: "Management Science", label: "📊 Management Science" },
  { value: "Managerial Economics", label: "📉 Managerial Economics" },
  { value: "Marine Biology", label: "🐳 Marine Biology" },
  { value: "Marine Engineering", label: "⚓ Marine Engineering" },
  { value: "Marketing", label: "📈 Marketing" },
  { value: "Mass Communication", label: "📡 Mass Communication" },
  { value: "Mathematics", label: "📐 Mathematics" },
  { value: "Mathematics Teacher Education", label: "🔢 Mathematics Teacher Education" },
  { value: "Mechanical Engineering", label: "🔧 Mechanical Engineering" },
  { value: "Mechatronics", label: "🦾 Mechatronics" },
  { value: "Media Studies", label: "📺 Media Studies" },
  { value: "Medical Radiologic Technology", label: "☢️ Medical Radiologic Technology" },
  { value: "Medicine", label: "⚕️ Medicine" },
  { value: "Microbiology", label: "🦠 Microbiology" },
  { value: "Middle School Education", label: "🏫 Middle School Education" },
  { value: "Mining Engineering", label: "⛏️ Mining Engineering" },
  { value: "Multimedia", label: "💻 Multimedia" },
  { value: "Music", label: "🎵 Music" },
  { value: "Music Management", label: "🎵 Music Management" },
  { value: "Music Performance", label: "🎸 Music Performance" },
  { value: "Music Teacher Education", label: "🎵 Music Teacher Education" },
  { value: "Neuroscience", label: "🧠 Neuroscience" },
  { value: "Nursing", label: "🏥 Nursing" },
  { value: "Nursing Research", label: "🏥 Nursing Research" },
  { value: "Nursing Science", label: "🏥 Nursing Science" },
  { value: "Nutrition", label: "🥗 Nutrition" },
  { value: "Nutrition Sciences", label: "🥗 Nutrition Sciences" },
  { value: "Operations Management", label: "📋 Operations Management" },
  { value: "Organizational Behavior", label: "👥 Organizational Behavior" },
  { value: "Organizational Communication", label: "🗣️ Organizational Communication" },
  { value: "Parks, Recreation and Leisure Facilities Management", label: "🏞️ Parks, Recreation and Leisure Facilities Management" },
  { value: "Parks, Recreation and Leisure Studies", label: "🏞️ Parks, Recreation and Leisure Studies" },
  { value: "Petroleum Engineering", label: "🛢️ Petroleum Engineering" },
  { value: "Pharmacy", label: "💊 Pharmacy" },
  { value: "Philosophy", label: "🤔 Philosophy" },
  { value: "Photography", label: "📷 Photography" },
  { value: "Physical Education Teaching and Coaching", label: "🏃 Physical Education Teaching and Coaching" },
  { value: "Physics", label: "⚛️ Physics" },
  { value: "Physiology, Pathology, and Related Sciences, Other", label: "🔬 Physiology, Pathology, and Related Sciences, Other" },
  { value: "Physiotherapy", label: "💆 Physiotherapy" },
  { value: "Police Science", label: "👮 Police Science" },
  { value: "Political Science", label: "🗳️ Political Science" },
  { value: "Power Systems", label: "⚡ Power Systems" },
  { value: "Production Engineering", label: "🏭 Production Engineering" },
  { value: "Project Management", label: "📊 Project Management" },
  { value: "Psychology", label: "🧠 Psychology" },
  { value: "Public Administration", label: "🏛️ Public Administration" },
  { value: "Public Health", label: "🏥 Public Health" },
  { value: "Public Health Education", label: "🏥 Public Health Education" },
  { value: "Public Policy Analysis", label: "📊 Public Policy Analysis" },
  { value: "Public Relations", label: "🤝 Public Relations" },
  { value: "Public Relations/Image Management", label: "🤝 Public Relations/Image Management" },
  { value: "Radio and Television", label: "📻 Radio and Television" },
  { value: "Radiologic Technology", label: "☢️ Radiologic Technology" },
  { value: "Real Estate", label: "🏠 Real Estate" },
  { value: "Religious Studies", label: "🛐 Religious Studies" },
  { value: "Renewable Energy", label: "☀️ Renewable Energy" },
  { value: "Respiratory Care Therapy", label: "🫁 Respiratory Care Therapy" },
  { value: "Rhetoric and Composition", label: "✍️ Rhetoric and Composition" },
  { value: "Robotics", label: "🤖 Robotics" },
  { value: "Robotics & AI", label: "🦾 Robotics & AI" },
  { value: "Sales", label: "💰 Sales" },
  { value: "Secondary Education", label: "🏫 Secondary Education" },
  { value: "Social Work", label: "🤝 Social Work" },
  { value: "Sociology", label: "👥 Sociology" },
  { value: "Software Engineering", label: "💻 Software Engineering" },
  { value: "Spanish Language and Literature", label: "🇪🇸 Spanish Language and Literature" },
  { value: "Special Education", label: "🏫 Special Education" },
  { value: "Speech and Rhetoric", label: "🗣️ Speech and Rhetoric" },
  { value: "Speech-Language Pathology", label: "🗣️ Speech-Language Pathology" },
  { value: "Sport and Fitness Administration", label: "⚽ Sport and Fitness Administration" },
  { value: "Statistics", label: "📈 Statistics" },
  { value: "Structural Engineering", label: "🏗️ Structural Engineering" },
  { value: "Studio Art", label: "🎨 Studio Art" },
  { value: "Supply Chain Management", label: "📦 Supply Chain Management" },
  { value: "Talmudic Studies", label: "📖 Talmudic Studies" },
  { value: "Taxation", label: "💰 Taxation" },
  { value: "Teacher Education", label: "👩‍🏫 Teacher Education" },
  { value: "Textile Engineering", label: "🧵 Textile Engineering" },
  { value: "Theology", label: "🛐 Theology" },
  { value: "Tourism Management", label: "✈️ Tourism Management" },
  { value: "Transportation Engineering", label: "🚆 Transportation Engineering" },
  { value: "UI/UX Design", label: "🎨 UI/UX Design" },
  { value: "Urban Planning", label: "🏙️ Urban Planning" },
  { value: "Veterinary Science", label: "🐕 Veterinary Science" },
  { value: "Visual and Performing Arts", label: "🎭 Visual and Performing Arts" },
  { value: "Visual Design", label: "🎨 Visual Design" },
  { value: "VLSI Design", label: "🔌 VLSI Design" },
  { value: "Web Design", label: "🌐 Web Design" },
  { value: "Zoology", label: "🦁 Zoology" }
];

const SearchableMajorSelect = ({ value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredMajors = useMemo(() => {
    const q = search.toLowerCase();
    return MAJORS_LIST.filter(m => m.value.toLowerCase().includes(q) || m.label.toLowerCase().includes(q));
  }, [search]);

  const groupedMajors = useMemo(() => {
    return filteredMajors.reduce((acc, major) => {
      const firstLetter = major.value[0].toUpperCase();
      if (!acc[firstLetter]) acc[firstLetter] = [];
      acc[firstLetter].push(major);
      return acc;
    }, {});
  }, [filteredMajors]);

  const selectedLabel = value === 'All' ? 'Major' : MAJORS_LIST.find(m => m.value === value)?.label || 'Major';

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className={styles.filterDropdown}
        onClick={() => setIsOpen(!isOpen)}
        style={{ textAlign: 'left', paddingRight: '2.5rem' }}
      >
        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
          {selectedLabel}
        </span>
      </button>

      {isOpen && (
        <div className={styles.customDropdownMenu}>
          <div className={styles.customDropdownSearch}>
            <Search size={14} color="var(--color-icon-base)" />
            <input
              autoFocus
              type="text"
              placeholder="Search major..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={styles.customDropdownInput}
            />
          </div>
          <div className={styles.customDropdownList}>
            <div
              className={`${styles.customDropdownOption} ${value === 'All' ? styles.selected : ''}`}
              onClick={() => { onChange('All'); setIsOpen(false); setSearch(""); }}
            >
              All Majors
            </div>

            {Object.entries(groupedMajors).sort(([a], [b]) => a.localeCompare(b)).map(([letter, majors]) => (
              <div key={letter}>
                <div className={styles.customDropdownGroupHeader}>{letter}</div>
                {majors.map(m => (
                  <div
                    key={m.value}
                    className={`${styles.customDropdownOption} ${value === m.value ? styles.selected : ''}`}
                    onClick={() => { onChange(m.value); setIsOpen(false); setSearch(""); }}
                  >
                    {m.label}
                  </div>
                ))}
              </div>
            ))}

            {filteredMajors.length === 0 && (
              <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
                No majors found.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const CustomClassYearSelect = ({ value, onChange, years }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedLabel = value === 'All' ? 'Class Year' : `Class of ${value}`;

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className={styles.filterDropdown}
        onClick={() => setIsOpen(!isOpen)}
        style={{ textAlign: 'left', paddingRight: '2.5rem' }}
      >
        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
          {selectedLabel}
        </span>
      </button>

      {isOpen && (
        <div className={styles.customDropdownMenu} style={{ width: '180px' }}>
          <div className={styles.customDropdownList}>
            <div
              className={`${styles.customDropdownOption} ${value === 'All' ? styles.selected : ''}`}
              onClick={() => { onChange('All'); setIsOpen(false); }}
            >
              Class Year
            </div>
            
            {years.map(y => (
              <div
                key={y}
                className={`${styles.customDropdownOption} ${value === y.toString() ? styles.selected : ''}`}
                onClick={() => { onChange(y.toString()); setIsOpen(false); }}
              >
                Class of {y}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default function DirectoryPage() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { users } = useData();

  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [dirBranch, setDirBranch] = useState('All');
  const [dirYear, setDirYear] = useState('All');

  const userCollegeId = currentUser?.collegeId || 'gla';

  const collegeStudents = useMemo(() => {
    let list = Object.values(users).filter(u => u.collegeId === userCollegeId);
    list = list.filter(u => u.id !== currentUser?.id);

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(u =>
        u.displayName?.toLowerCase().includes(q) ||
        u.bio?.toLowerCase().includes(q) ||
        u.skills?.some(s => s.toLowerCase().includes(q))
      );
    }
    if (dirBranch !== 'All') list = list.filter(u => u.course === dirBranch || u.role === dirBranch);
    if (dirYear !== 'All') list = list.filter(u => u.year === dirYear);

    return list;
  }, [users, userCollegeId, searchQuery, dirBranch, dirYear, currentUser]);

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    showToast('Directory link copied! 🔗');
  };

  const currentYear = new Date().getFullYear();
  const maxYear = currentYear + 6;
  const classYears = [];
  for (let y = 2026; y <= maxYear; y++) {
    classYears.push(y);
  }

  return (
    <main className={`centre centre-wide ${styles.hubContainer}`}>
      <div className={`${styles.headerBanner} ${styles.compactHeader}`}>
        <header className={styles.header}>
          {showSearch ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', minHeight: '42px' }}>
              <button className={styles.headerSquareBtn} onClick={() => { setShowSearch(false); setSearchQuery(""); }} title="Close Search">
                <ArrowLeft size={20} />
              </button>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', background: 'transparent', borderRadius: '12px', padding: '0', border: 'none' }}>
                <input
                  type="text"
                  placeholder="Search students..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={styles.headerSearchInput}
                  style={{ flex: 1, border: 'none', background: 'transparent', color: 'white', padding: '0.5rem 0.5rem', outline: 'none', fontSize: '1rem' }}
                  autoFocus
                />
              </div>
            </div>
          ) : (
            <>
              <div className={styles.headerLeftGroup}>
                <button className={styles.headerSquareBtn} onClick={() => navigate('/campus')} title="Back to Campus">
                  <ArrowLeft size={20} />
                </button>
                <h1 className={styles.collegeTitle} style={{ margin: 0 }}>Student Directory</h1>
              </div>
              <div className={styles.headerActions}>
                <button className={styles.headerSquareBtn} onClick={() => setShowSearch(true)} title="Search Directory">
                  <Search size={20} />
                </button>
                <button className={styles.headerSquareBtn} onClick={() => showToast('Feature coming soon!')} title="Add Student">
                  <Plus size={20} />
                </button>
              </div>
            </>
          )}
        </header>


      </div>

      <div className={styles.campusBody}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <CustomClassYearSelect value={dirYear} onChange={setDirYear} years={classYears} />
          <SearchableMajorSelect value={dirBranch} onChange={setDirBranch} />
        </div>



        <div className={styles.directoryGrid}>
          {currentUser && (
            <div
              key={`current-user-${currentUser.id}`}
              className={styles.directoryCard}
              onClick={() => navigate(`/profile/${currentUser.username}`)}
            >
              <Avatar
                src={currentUser.avatar}
                name={currentUser.displayName || currentUser.username}
                size="56px"
                showInitials
              />
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center', overflow: 'hidden' }}>
                <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: '500', color: 'var(--color-text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {currentUser.displayName} (You)
                </h4>
              </div>
            </div>
          )}
          {collegeStudents.map(student => (
            <div
              key={student.id}
              className={styles.directoryCard}
              onClick={() => navigate(`/profile/${student.username}`)}
            >
              <Avatar
                src={student.avatar}
                name={student.displayName || student.username}
                size="56px"
                showInitials
              />
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: '500', color: 'var(--color-text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {student.displayName}
                </h4>
                <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                  Class of {student.year || 'XXXX'}
                </p>
              </div>
            </div>
          ))}
          {collegeStudents.length === 0 && (
            <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '2rem 0', gridColumn: '1 / -1' }}>
              No students found.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
