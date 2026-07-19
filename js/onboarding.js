import supabase from './supabase.js';

document.addEventListener('DOMContentLoaded', () => {
  let currentStep = 1;
  const totalSteps = 5;
  
  // Elementos del DOM
  const form = document.getElementById('onboarding-form');
  const alertContainer = document.getElementById('onboarding-alert');
  const loader = document.getElementById('loading-overlay');
  const loaderText = document.getElementById('loading-text');
  const loaderSubtext = document.getElementById('loading-subtext');
  
  // Paneles e Indicadores
  const panels = document.querySelectorAll('.step-panel');
  const stepItems = document.querySelectorAll('.step-item');
  const progressLine = document.getElementById('stepper-progress');
  
  // Botones Navegación
  const btnBack = document.getElementById('btn-back');
  const btnNext = document.getElementById('btn-next');
  const btnFinish = document.getElementById('btn-finish-go-wms');
  
  // Elementos Condicionales
  const meliCheckbox = document.getElementById('mp-meli');
  const meliOptionsContainer = document.getElementById('meli-options-container');
  
  // Drag & Drop File Upload
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('contrato_file');
  const filePreview = document.getElementById('file-preview-el');
  const fileNameSpan = document.getElementById('file-name-span');
  const fileSizeSpan = document.getElementById('file-size-span');
  const fileRemoveBtn = document.getElementById('file-remove-btn');
  let selectedFile = null;

  // --- MÉTODOS DE UTILIDAD Y VALIDACIÓN ---

  // Mostrar Alerta
  const showAlert = (message, type = 'error') => {
    alertContainer.innerHTML = `<div class="alert alert-${type}"><i class="ri-alert-line"></i> <div>${message}</div></div>`;
    alertContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const clearAlert = () => {
    alertContainer.innerHTML = '';
  };

  // Mostrar Loader
  const showLoader = (text, subtext = 'Por favor, espera.') => {
    loaderText.textContent = text;
    loaderSubtext.textContent = subtext;
    loader.style.display = 'flex';
  };

  const hideLoader = () => {
    loader.style.display = 'none';
  };

  // Formateador de RUT chileno
  const formatRut = (value) => {
    const clean = value.replace(/[^0-9kK]/g, '');
    if (!clean) return '';
    if (clean.length === 1) return clean;
    
    const dv = clean.slice(-1).toUpperCase();
    let body = clean.slice(0, -1);
    
    let formattedBody = '';
    while (body.length > 3) {
      formattedBody = '.' + body.slice(-3) + formattedBody;
      body = body.slice(0, -3);
    }
    formattedBody = body + formattedBody;
    
    return `${formattedBody}-${dv}`;
  };

  // Validador oficial de RUT chileno
  const validateRut = (rut) => {
    if (!rut) return false;
    const clean = rut.replace(/[^0-9kK]/g, '');
    if (clean.length < 8) return false;
    
    const body = clean.slice(0, -1);
    const dv = clean.slice(-1).toUpperCase();
    
    let sum = 0;
    let multiplier = 2;
    for (let i = body.length - 1; i >= 0; i--) {
      sum += parseInt(body[i]) * multiplier;
      multiplier = multiplier === 7 ? 2 : multiplier + 1;
    }
    
    const expectedDv = 11 - (sum % 11);
    let expectedDvStr = '';
    if (expectedDv === 11) expectedDvStr = '0';
    else if (expectedDv === 10) expectedDvStr = 'K';
    else expectedDvStr = expectedDv.toString();
    
    return dv === expectedDvStr;
  };

  // Formatear RUTs mientras escribe
  const rutInputs = ['rut_personal', 'rut_empresa'];
  rutInputs.forEach(id => {
    const input = document.getElementById(id);
    if (input) {
      input.addEventListener('input', (e) => {
        let cursorPosition = e.target.selectionStart;
        const previousLength = e.target.value.length;
        
        e.target.value = formatRut(e.target.value);
        
        const currentLength = e.target.value.length;
        cursorPosition += (currentLength - previousLength);
        e.target.setSelectionRange(cursorPosition, cursorPosition);
      });
    }
  });

  // --- SELECCIONAR CARDS DE OPCIÓN ---
  document.querySelectorAll('.option-card').forEach(card => {
    const cb = card.querySelector('input[type="checkbox"], input[type="radio"]');
    if (cb) {
      // Sincronizar estado inicial
      if (cb.checked) card.classList.add('selected');
      
      cb.addEventListener('change', () => {
        if (cb.type === 'radio') {
          // Si es radio, desmarcar hermanos
          const name = cb.getAttribute('name');
          document.querySelectorAll(`input[name="${name}"]`).forEach(radio => {
            radio.closest('.option-card').classList.remove('selected');
          });
        }
        
        if (cb.checked) {
          card.classList.add('selected');
        } else {
          card.classList.remove('selected');
        }
      });
    }
  });

  // Mostrar opciones de Meli condicionalmente
  if (meliCheckbox) {
    meliCheckbox.addEventListener('change', () => {
      if (meliCheckbox.checked) {
        meliOptionsContainer.style.display = 'block';
      } else {
        meliOptionsContainer.style.display = 'none';
        // Desmarcar todas las opciones de ML si se oculta
        document.querySelectorAll('input[name="ml_opciones"]').forEach(cb => {
          cb.checked = false;
          cb.closest('.option-card').classList.remove('selected');
        });
      }
    });
  }

  // --- COMPORTAMIENTO DRAG & DROP ---
  const handleFiles = (files) => {
    if (files.length === 0) return;
    const file = files[0];
    
    if (file.type !== 'application/pdf') {
      showAlert('Por favor, selecciona un archivo en formato PDF.');
      return;
    }
    
    if (file.size > 10 * 1024 * 1024) { // 10MB
      showAlert('El archivo supera el límite de 10 MB.');
      return;
    }
    
    selectedFile = file;
    fileNameSpan.textContent = file.name;
    fileSizeSpan.textContent = `(${(file.size / 1024 / 1024).toFixed(2)} MB)`;
    filePreview.style.display = 'flex';
    dropZone.style.borderColor = 'var(--color-success)';
    clearAlert();
  };

  if (dropZone) {
    ['dragenter', 'dragover'].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.style.borderColor = 'var(--color-accent)';
        dropZone.style.background = 'var(--color-surface-hover)';
      }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.style.borderColor = 'var(--color-border)';
        dropZone.style.background = 'var(--color-bg)';
      }, false);
    });

    dropZone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      const files = dt.files;
      handleFiles(files);
    });

    dropZone.addEventListener('click', () => {
      fileInput.click();
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      handleFiles(e.target.files);
    });
  }

  if (fileRemoveBtn) {
    fileRemoveBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectedFile = null;
      fileInput.value = '';
      filePreview.style.display = 'none';
      dropZone.style.borderColor = 'var(--color-border)';
      dropZone.style.background = 'var(--color-bg)';
    });
  }

  // --- NAVEGACIÓN Y VALIDACIONES DE PASO ---

  const validateStep = (step) => {
    clearAlert();
    
    if (step === 1) {
      const name = document.getElementById('full_name').value.trim();
      const rut = document.getElementById('rut_personal').value.trim();
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value.trim();
      const phone = document.getElementById('phone').value.trim();
      
      if (!name || !rut || !email || !password || !phone) {
        showAlert('Por favor, completa todos los campos obligatorios (*).');
        return false;
      }
      
      if (!validateRut(rut)) {
        showAlert('El RUT Personal ingresado no es válido.');
        return false;
      }
      
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        showAlert('Por favor, ingresa un correo electrónico válido.');
        return false;
      }
      
      if (password.length < 6) {
        showAlert('La contraseña debe tener al menos 6 caracteres.');
        return false;
      }
    }
    
    if (step === 2) {
      const razon = document.getElementById('razon_social').value.trim();
      const rutEmpresa = document.getElementById('rut_empresa').value.trim();
      const giro = document.getElementById('giro_comercio').value.trim();
      const dir = document.getElementById('direccion_facturacion').value.trim();
      const comuna = document.getElementById('comuna').value.trim();
      const emailFac = document.getElementById('email_facturacion').value.trim();
      
      if (!razon || !rutEmpresa || !giro || !dir || !comuna || !emailFac) {
        showAlert('Por favor, completa todos los campos obligatorios de facturación.');
        return false;
      }
      
      if (!validateRut(rutEmpresa)) {
        showAlert('El RUT de la Empresa no es válido.');
        return false;
      }
      
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(emailFac)) {
        showAlert('Por favor, ingresa un correo de facturación válido.');
        return false;
      }
    }
    
    if (step === 3) {
      const fantasia = document.getElementById('nombre_fantasia').value.trim();
      const platSelected = document.querySelectorAll('input[name="plataformas"]:checked').length;
      const mpSelected = document.querySelectorAll('input[name="marketplaces"]:checked').length;
      const courierStgo = document.querySelectorAll('input[name="courier_santiago"]:checked').length;
      const courierReg = document.querySelectorAll('input[name="courier_regiones"]:checked').length;
      const pack = document.getElementById('descripcion_packaging').value.trim();
      
      if (!fantasia || !pack) {
        showAlert('Por favor, completa los campos de texto requeridos.');
        return false;
      }
      
      if (platSelected === 0) {
        showAlert('Debes seleccionar al menos una plataforma de ventas.');
        return false;
      }
      
      if (mpSelected === 0) {
        showAlert('Debes seleccionar al menos un Marketplace.');
        return false;
      }
      
      if (courierStgo === 0) {
        showAlert('Debes seleccionar al menos una alternativa de courier para Santiago.');
        return false;
      }
      
      if (courierReg === 0) {
        showAlert('Debes seleccionar al menos una alternativa de courier para Regiones.');
        return false;
      }
    }
    
    if (step === 4) {
      if (!selectedFile) {
        showAlert('Debes cargar tu contrato firmado en formato PDF.');
        return false;
      }
      
      const termsAccepted = document.getElementById('accept_terms').checked;
      if (!termsAccepted) {
        showAlert('Debes declarar que aceptas los términos y condiciones del servicio.');
        return false;
      }
    }
    
    return true;
  };

  const updateStepper = () => {
    // Actualizar paneles
    panels.forEach(p => p.classList.remove('active'));
    document.getElementById(`panel-${currentStep}`).classList.add('active');
    
    // Actualizar progreso
    stepItems.forEach((item, idx) => {
      const stepNum = idx + 1;
      item.classList.remove('active', 'completed');
      
      if (stepNum === currentStep) {
        item.classList.add('active');
      } else if (stepNum < currentStep) {
        item.classList.add('completed');
      }
    });
    
    const percentage = ((currentStep - 1) / (totalSteps - 1)) * 90; // Proporcional
    progressLine.style.width = `${percentage}%`;
    
    // Controlar botones de acción en footer
    if (currentStep === 1) {
      btnBack.style.visibility = 'hidden';
      btnNext.innerHTML = `Siguiente <i class="ri-arrow-right-line"></i>`;
    } else if (currentStep === 4) {
      btnBack.style.visibility = 'visible';
      btnNext.innerHTML = `Firmar y Enviar <i class="ri-rocket-2-line"></i>`;
    } else if (currentStep === 5) {
      // Ocultar barra de navegación del wizard
      document.getElementById('wizard-navigation').style.display = 'none';
    } else {
      btnBack.style.visibility = 'visible';
      btnNext.innerHTML = `Siguiente <i class="ri-arrow-right-line"></i>`;
    }
  };

  // Click Siguiente / Enviar
  btnNext.addEventListener('click', async () => {
    // Si estamos en el paso 1, verificar asíncronamente si el correo ya existe
    if (currentStep === 1) {
      if (!validateStep(1)) return;
      
      const email = document.getElementById('email').value.trim();
      
      btnNext.disabled = true;
      btnNext.innerHTML = `<i class="ri-loader-4-line spin"></i> Verificando...`;
      
      try {
        const { data: exists, error } = await supabase.rpc('check_email_exists', { p_email: email });
        
        if (error) throw error;
        
        if (exists) {
          showAlert('El correo electrónico ya se encuentra registrado en el sistema. Intenta con otro o inicia sesión.');
          btnNext.disabled = false;
          btnNext.innerHTML = `Siguiente <i class="ri-arrow-right-line"></i>`;
          return;
        }
      } catch (err) {
        console.warn('Advertencia verificando correo:', err);
        // Si el RPC da error (por ejemplo, si no han corrido la migración),
        // permitimos avanzar por resiliencia, pero informamos en consola.
      }
      
      btnNext.disabled = false;
      btnNext.innerHTML = `Siguiente <i class="ri-arrow-right-line"></i>`;
    } else {
      if (!validateStep(currentStep)) return;
    }
    
    if (currentStep < 4) {
      currentStep++;
      updateStepper();
    } else if (currentStep === 4) {
      // ENVIAR FORMULARIO AL COMPLETAR EL PASO 4
      await submitOnboarding();
    }
  });

  // Click Atrás
  btnBack.addEventListener('click', () => {
    if (currentStep > 1 && currentStep < 5) {
      currentStep--;
      updateStepper();
    }
  });

  // --- REGISTRO Y SUBIDA A SUPABASE ---
  const submitOnboarding = async () => {
    clearAlert();
    
    // Obtener campos de los formularios
    const name = document.getElementById('full_name').value.trim();
    const rutPersonal = document.getElementById('rut_personal').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const cargo = document.getElementById('cargo').value.trim();
    
    const razon = document.getElementById('razon_social').value.trim();
    const rutEmpresa = document.getElementById('rut_empresa').value.trim();
    const giro = document.getElementById('giro_comercio').value.trim();
    const dir = document.getElementById('direccion_facturacion').value.trim();
    const comuna = document.getElementById('comuna').value.trim();
    const emailFac = document.getElementById('email_facturacion').value.trim();
    
    const fantasia = document.getElementById('nombre_fantasia').value.trim();
    const sitio = document.getElementById('sitio_web').value.trim();
    
    const plataformas = Array.from(document.querySelectorAll('input[name="plataformas"]:checked')).map(cb => cb.value);
    const marketplaces = Array.from(document.querySelectorAll('input[name="marketplaces"]:checked')).map(cb => cb.value);
    const mlOpciones = Array.from(document.querySelectorAll('input[name="ml_opciones"]:checked')).map(cb => cb.value);
    const courierStgo = Array.from(document.querySelectorAll('input[name="courier_santiago"]:checked')).map(cb => cb.value);
    const courierReg = Array.from(document.querySelectorAll('input[name="courier_regiones"]:checked')).map(cb => cb.value);
    const offersRetiro = document.getElementById('retiro_sucursal').checked;
    const packagingDesc = document.getElementById('descripcion_packaging').value.trim();

    try {
      // 1. Crear usuario en Supabase Auth
      showLoader('Creando cuenta de usuario...', 'Registrando tus credenciales en el portal.');
      
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: email,
        password: password,
        options: {
          data: {
            full_name: name,
            company_name: razon
          }
        }
      });
      
      if (authError) throw authError;
      
      const userId = authData.user ? authData.user.id : null;
      if (!userId) {
        throw new Error('No se pudo generar el identificador único de usuario.');
      }
      
      // 2. Subir contrato PDF firmado a Supabase Storage
      showLoader('Subiendo contrato firmado...', 'Almacenando tu documento PDF de forma segura.');
      
      const sanitizedName = selectedFile.name.replace(/[^a-zA-Z0-9.]/g, '_');
      const storagePath = `onboarding/${userId}_${Date.now()}_${sanitizedName}`;
      
      // Intentar subir el archivo
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('service_docs')
        .upload(storagePath, selectedFile);
        
      if (uploadError) throw uploadError;
      
      // Obtener URL pública del archivo cargado
      const { data: urlData } = supabase.storage
        .from('service_docs')
        .getPublicUrl(storagePath);
        
      const contratoUrl = urlData.publicUrl;

      // 3. Crear solicitud de onboarding llamando a la RPC de Base de Datos
      showLoader('Registrando datos comerciales...', 'Enviando solicitud al equipo comercial de Stocka.');
      
      const { data: rpcData, error: rpcError } = await supabase.rpc('create_onboarding_request', {
        p_user_id: userId,
        p_full_name: name,
        p_rut_personal: rutPersonal,
        p_email: email,
        p_phone: phone,
        p_cargo: cargo || null,
        p_razon_social: razon,
        p_rut_empresa: rutEmpresa,
        p_giro_comercio: giro,
        p_direccion_facturacion: dir,
        p_comuna: comuna,
        p_email_facturacion: emailFac,
        p_nombre_fantasia: fantasia,
        p_sitio_web: sitio || null,
        p_plataformas_venta: plataformas,
        p_marketplaces: marketplaces,
        p_courier_santiago: courierStgo,
        p_courier_regiones: courierReg,
        p_ml_opciones: mlOpciones,
        p_retiro_sucursal: offersRetiro,
        p_descripcion_packaging: packagingDesc,
        p_contrato_url: contratoUrl,
        p_contrato_storage_path: storagePath
      });
      
      if (rpcError) throw rpcError;
      
      // 4. Éxito: Avanzar al paso 5
      hideLoader();
      currentStep = 5;
      updateStepper();
      
    } catch (err) {
      hideLoader();
      console.error('Error durante el onboarding:', err);
      showAlert(`Ocurrió un error al procesar tu solicitud: ${err.message || 'Inténtalo de nuevo más tarde.'}`);
    }
  };

  // Botón Finalizar
  if (btnFinish) {
    btnFinish.addEventListener('click', () => {
      // Redirigir al portal, el cual verificará sesión
      window.location.href = './index.html';
    });
  }
});
