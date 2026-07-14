const fs = require('fs');
const file = 'src/features/messages/components/chat/ChatArea.jsx';
let jsx = fs.readFileSync(file, 'utf8');

// 1. Add import
jsx = jsx.replace("import ChatHeader from './ChatHeader';", "import ChatHeader from './ChatHeader';\nimport ChatInputArea from './ChatInputArea';");

// 2. Remove states and functions
const stateStart = 'const [inputValue, setInputValue] = useState';
const stateEndStr = '    setRecordingTime(0);\n  };\n';
const stateStartIdx = jsx.indexOf(stateStart);
const stateEndIdx = jsx.indexOf(stateEndStr, stateStartIdx);

if (stateStartIdx !== -1 && stateEndIdx !== -1) {
  jsx = jsx.substring(0, stateStartIdx) + jsx.substring(stateEndIdx + stateEndStr.length);
}

// 3. Remove handleSend
const handleSendStart = 'const handleSend = () => {';
const handleSendEndStr = '  };\n';
const handleSendStartIdx = jsx.indexOf(handleSendStart);
const handleSendEndIdx = jsx.indexOf(handleSendEndStr, handleSendStartIdx);

if (handleSendStartIdx !== -1 && handleSendEndIdx !== -1) {
  jsx = jsx.substring(0, handleSendStartIdx) + jsx.substring(handleSendEndIdx + handleSendEndStr.length);
}

// 4. Remove formatDuration
const formatDurationStart = 'const formatDuration = (secs) => {';
const formatDurationEndStr = '  };\n';
const formatDurationStartIdx = jsx.indexOf(formatDurationStart);
const formatDurationEndIdx = jsx.indexOf(formatDurationEndStr, formatDurationStartIdx);

if (formatDurationStartIdx !== -1 && formatDurationEndIdx !== -1) {
  jsx = jsx.substring(0, formatDurationStartIdx) + jsx.substring(formatDurationEndIdx + formatDurationEndStr.length);
}

// 5. Replace render
const renderStart = '{/* Input container */}';
const renderEndStr = '      </div>\n\n      {showGroupSettings && (';
const renderStartIdx = jsx.indexOf(renderStart);
const renderEndIdx = jsx.indexOf(renderEndStr, renderStartIdx);

if (renderStartIdx !== -1 && renderEndIdx !== -1) {
  const replacement = `      <ChatInputArea 
        conversation={conversation}
        currentUser={currentUser}
        onSendMessage={onSendMessage}
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
        setIsTyping={setIsTyping}
        onJoinGroup={onJoinGroup}
        onBlockUser={onBlockUser}
        showToast={window.showToast}
      />\n`;
  jsx = jsx.substring(0, renderStartIdx) + replacement + jsx.substring(renderEndIdx);
}

fs.writeFileSync(file, jsx);
console.log('ChatArea updated for ChatInputArea');
