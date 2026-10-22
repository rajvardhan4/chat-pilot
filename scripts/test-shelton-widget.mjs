async function test() {
  const res = await fetch('https://lmgdemo2.com/shelton/?cp_bust=' + Date.now());
  const html = await res.text();
  const containerMatch = html.match(/id="chat-pilot-widget-container"[^>]+/);
  const scriptMatch = html.match(/var chatPilotWidget = ({[^}]+(?:{[^}]+}[^}]+)*});/);
  console.log('Container tag:', containerMatch ? containerMatch[0] : 'None');
  if (scriptMatch) {
    try {
      const obj = JSON.parse(scriptMatch[1]);
      console.log('chatPilotWidget themeMode:', obj.themeMode);
      console.log('Full chatPilotWidget config snippet:', {
        position: obj.position,
        themeMode: obj.themeMode,
        primaryColor: obj.primaryColor,
        pluginName: obj.pluginName
      });
    } catch(e) {
      console.log('Raw script slice:', scriptMatch[0].slice(0, 300));
    }
  } else {
    // Search for chatPilotWidget anywhere
    const idx = html.indexOf('chatPilotWidget');
    if (idx !== -1) {
      console.log('Found chatPilotWidget at index', idx, ':', html.slice(idx, idx + 300));
    } else {
      console.log('chatPilotWidget not found in HTML');
    }
  }
}
test().catch(console.error);
