export function initChatWidget() {
  // Inject CSS dynamically so we don't need to bloat layout.css with chat-specific code
  const style = document.createElement('style');
  style.textContent = `
    #stockin-chat-widget {
      position: fixed;
      bottom: 90px;
      right: 2rem;
      width: 350px;
      background: var(--color-surface);
      border-radius: var(--radius-lg);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
      border: 1px solid var(--color-border);
      display: flex;
      flex-direction: column;
      z-index: 1000;
      opacity: 0;
      transform: translateY(20px) scale(0.95);
      pointer-events: none;
      transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      overflow: hidden;
    }
    
    #stockin-chat-widget.active {
      opacity: 1;
      transform: translateY(0) scale(1);
      pointer-events: auto;
    }

    .chat-header {
      background: linear-gradient(135deg, var(--color-primary), var(--color-accent));
      color: white;
      padding: 1rem 1.25rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .chat-header h4 {
      margin: 0;
      font-size: 1.1rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    
    .chat-header .close-btn {
      background: rgba(255, 255, 255, 0.2);
      border: none;
      color: white;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: background 0.2s;
    }
    
    .chat-header .close-btn:hover {
      background: rgba(255, 255, 255, 0.4);
    }
    
    .chat-body {
      padding: 1.25rem;
      height: 320px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 1rem;
      background: var(--color-bg);
    }
    
    .chat-message {
      max-width: 85%;
      padding: 0.75rem 1rem;
      border-radius: 12px;
      font-size: 0.9rem;
      line-height: 1.4;
      animation: fadeIn 0.3s ease;
    }
    
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(5px); }
      to { opacity: 1; transform: translateY(0); }
    }
    
    .chat-message.bot {
      background: var(--color-surface);
      color: var(--color-text-main);
      align-self: flex-start;
      border: 1px solid var(--color-border);
      border-bottom-left-radius: 4px;
    }
    
    .chat-message.user {
      background: var(--color-primary);
      color: white;
      align-self: flex-end;
      border-bottom-right-radius: 4px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.2);
    }
    
    .chat-options {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }
    
    .chat-option-btn {
      background: var(--color-surface);
      border: 1px solid var(--color-primary);
      color: var(--color-primary);
      padding: 0.6rem 1rem;
      border-radius: var(--radius-full);
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      text-align: center;
    }
    
    .chat-option-btn:hover {
      background: var(--color-primary);
      color: white;
    }
    
    .kam-card {
      background: var(--color-surface-hover);
      border: 1px solid var(--color-border);
      padding: 1rem;
      border-radius: var(--radius-md);
      margin-top: 0.5rem;
    }
    
    .kam-card h5 { margin: 0 0 0.25rem 0; color: var(--color-primary); font-size: 1rem; }
    .kam-card p { margin: 0 0 0.25rem 0; font-size: 0.85rem; color: var(--color-text-main); }
    
    .kam-whatsapp-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: #25D366;
      color: white !important;
      padding: 0.5rem 1rem;
      border-radius: var(--radius-md);
      text-decoration: none;
      font-weight: 600;
      font-size: 0.85rem;
      margin-top: 0.75rem;
      transition: background 0.2s;
    }
    .kam-whatsapp-btn:hover { background: #1ebd5a; }
    
    /* Typing indicator */
    .typing-indicator {
      display: flex;
      gap: 4px;
      padding: 0.5rem 0;
    }
    .typing-indicator span {
      width: 6px;
      height: 6px;
      background: var(--color-text-muted);
      border-radius: 50%;
      animation: bounce 1.4s infinite ease-in-out both;
    }
    .typing-indicator span:nth-child(1) { animation-delay: -0.32s; }
    .typing-indicator span:nth-child(2) { animation-delay: -0.16s; }
    @keyframes bounce {
      0%, 80%, 100% { transform: scale(0); }
      40% { transform: scale(1); }
    }
  `;
  document.head.appendChild(style);

  // Inject Chat HTML
  const chatHtml = `
    <div id="stockin-chat-widget">
      <div class="chat-header">
        <h4><i class="ri-robot-2-line"></i> Stockin</h4>
        <button class="close-btn" id="close-chat-btn"><i class="ri-close-line"></i></button>
      </div>
      <div class="chat-body" id="chat-messages-container">
        <!-- Messages will be injected here -->
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', chatHtml);

  const supportBtn = document.getElementById('support-chat-btn');
  const chatWidget = document.getElementById('stockin-chat-widget');
  const closeBtn = document.getElementById('close-chat-btn');
  const messagesContainer = document.getElementById('chat-messages-container');
  
  let chatInitialized = false;

  if (supportBtn) {
    supportBtn.addEventListener('click', (e) => {
      e.preventDefault();
      chatWidget.classList.add('active');
      if (!chatInitialized) {
        startChat();
        chatInitialized = true;
      }
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      chatWidget.classList.remove('active');
    });
  }

  function appendBotMessage(htmlContent) {
    const msg = document.createElement('div');
    msg.className = 'chat-message bot';
    msg.innerHTML = htmlContent;
    messagesContainer.appendChild(msg);
    scrollToBottom();
  }

  function appendUserMessage(text) {
    const msg = document.createElement('div');
    msg.className = 'chat-message user';
    msg.textContent = text;
    messagesContainer.appendChild(msg);
    scrollToBottom();
  }

  function showTypingIndicator() {
    const msg = document.createElement('div');
    msg.className = 'chat-message bot typing-msg';
    msg.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
    messagesContainer.appendChild(msg);
    scrollToBottom();
    return msg;
  }

  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function disableOptions() {
    const options = document.querySelectorAll('.chat-option-btn');
    options.forEach(opt => {
      opt.style.opacity = '0.5';
      opt.style.pointerEvents = 'none';
    });
  }

  function startChat() {
    const typing = showTypingIndicator();
    setTimeout(() => {
      typing.remove();
      appendBotMessage("¡Hola! Un gusto, soy <strong>Stockin</strong>. ¿Cómo te podemos ayudar hoy?");
      
      const optionsDiv = document.createElement('div');
      optionsDiv.className = 'chat-options';
      optionsDiv.innerHTML = `
        <button class="chat-option-btn" id="opt-ticket">Crear un ticket/solicitud</button>
        <button class="chat-option-btn" id="opt-kam">Contactar con mi KAM</button>
      `;
      messagesContainer.appendChild(optionsDiv);
      scrollToBottom();

      document.getElementById('opt-ticket').addEventListener('click', handleTicketOption);
      document.getElementById('opt-kam').addEventListener('click', handleKamOption);
    }, 1000);
  }

  function handleTicketOption() {
    disableOptions();
    appendUserMessage("Crear un ticket/solicitud");
    
    const typing = showTypingIndicator();
    setTimeout(() => {
      typing.remove();
      appendBotMessage("¡Listo! Aquí puedes levantar tus casos y solicitudes.");
      
      // Auto-navigate after 1.5 seconds
      setTimeout(() => {
        chatWidget.classList.remove('active');
        
        const hiddenNav = document.querySelector('.hidden-ticket-nav');
        if (hiddenNav) hiddenNav.click();
        
        // Offer help again after 5 seconds
        setTimeout(offerMoreHelp, 5000);
      }, 1500);
    }, 1000);
  }

  function handleKamOption() {
    disableOptions();
    appendUserMessage("Contactar con mi KAM");
    
    const typing = showTypingIndicator();
    setTimeout(() => {
      typing.remove();
      const whatsappMsg = encodeURIComponent("Hola Fernanda, necesito ayuda con mi cuenta de Stocka...");
      appendBotMessage(`
        Claro, aquí tienes los datos de tu KAM asignada:
        <div class="kam-card">
          <h5>Fernanda Castro</h5>
          <p><i class="ri-mail-line"></i> gestion@stocka.cl</p>
          <p><i class="ri-phone-line"></i> +56 9 8135 4550</p>
          <a href="https://wa.me/56981354550?text=${whatsappMsg}" target="_blank" class="kam-whatsapp-btn">
            <i class="ri-whatsapp-line"></i> Escribir por WhatsApp
          </a>
        </div>
      `);
      
      // Offer help again after 5 seconds
      setTimeout(offerMoreHelp, 5000);
    }, 1000);
  }

  function offerMoreHelp() {
    const typing = showTypingIndicator();
    setTimeout(() => {
      typing.remove();
      appendBotMessage("¿Te ayudo con algo más?");
      
      const optionsDiv = document.createElement('div');
      optionsDiv.className = 'chat-options';
      optionsDiv.innerHTML = `
        <button class="chat-option-btn more-help-ticket">Crear un ticket/solicitud</button>
        <button class="chat-option-btn more-help-kam">Contactar con mi KAM</button>
      `;
      messagesContainer.appendChild(optionsDiv);
      scrollToBottom();

      optionsDiv.querySelector('.more-help-ticket').addEventListener('click', handleTicketOption);
      optionsDiv.querySelector('.more-help-kam').addEventListener('click', handleKamOption);
    }, 1000);
  }
}
