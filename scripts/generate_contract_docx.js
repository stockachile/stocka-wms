const fs = require('fs');
const path = require('path');
const HTMLtoDOCX = require('html-to-docx');

const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Contrato de Prestación de Servicios a Honorarios</title>
  <style>
    body {
      font-family: 'Calibri', 'Arial', sans-serif;
      font-size: 11pt;
      line-height: 1.35;
      color: #1a1a1a;
      text-align: justify;
    }
    h1 {
      font-size: 15pt;
      font-weight: bold;
      text-align: center;
      margin-bottom: 4px;
      text-transform: uppercase;
      color: #0f172a;
    }
    h2 {
      font-size: 12pt;
      font-weight: bold;
      text-align: center;
      margin-top: 0px;
      margin-bottom: 20px;
      color: #334155;
    }
    h3 {
      font-size: 11.5pt;
      font-weight: bold;
      margin-top: 14px;
      margin-bottom: 6px;
      color: #1e293b;
    }
    p {
      margin-top: 6px;
      margin-bottom: 8px;
      text-align: justify;
    }
    ul {
      margin-top: 4px;
      margin-bottom: 8px;
    }
    li {
      margin-bottom: 4px;
    }
    table {
      border-collapse: collapse;
      margin-top: 10px;
      margin-bottom: 14px;
    }
    table, th, td {
      border: 1px solid #94a3b8;
    }
    th, td {
      padding: 6px 10px;
      font-size: 10.5pt;
    }
    th {
      background-color: #f1f5f9;
      font-weight: bold;
    }
    .signature-table {
      border: none;
      margin-top: 40px;
      margin-bottom: 20px;
    }
    .signature-table td {
      border: none;
      text-align: center;
      vertical-align: top;
      padding-top: 30px;
    }
  </style>
</head>
<body>

  <h1>CONTRATO CIVIL DE PRESTACIÓN DE SERVICIOS A HONORARIOS</h1>
  <h2>TRANSPORTE Y REPARTO LOGÍSTICO ESPORÁDICO DE ÚLTIMA MILLA</h2>

  <p>
    En la ciudad de Santiago de Chile, a [ .......... ] de [ ..................................... ] de 202[ ... ], comparecen:
  </p>

  <p>
    Por una parte, como <b>"El Mandante"</b> o <b>"La Empresa"</b>: <br>
    <b>STK SOLUTIONS LOGISTICA Y SERVICIOS SPA</b>, Rol Único Tributario (RUT) Nº <b>78.519.038-6</b>, sociedad comercial del giro de soluciones logísticas y transporte, debidamente representada por su representante legal, don <b>FRANCISCO ESTEBAN TRUJILLO PEREZ</b>, chileno, titular de la Cédula Nacional de Identidad Nº <b>19.622.297-9</b>, ambos con domicilio para todos los efectos del presente contrato en <b>calle Los Militares Nº 5290, oficina 905, comuna de Las Condes</b>, ciudad de Santiago;
  </p>

  <p>
    Y por la otra parte, como <b>"El Prestador de Servicios"</b> o <b>"El Prestador"</b>: <br>
    Don <b>EMMANUEL SEBASTIÁN MAULÉN SANDOVAL</b>, chileno, mayor de edad, titular de la Cédula Nacional de Identidad Nº <b>16.411.808-8</b>, de oficio conductor de repartos, domiciliado para estos efectos en <b>calle Huerta Florida Nº 1214, comuna de La Florida</b>, ciudad de Santiago;
  </p>

  <p>
    Los comparecientes, mayores de edad, quienes acreditan sus respectivas identidades con los documentos de identificación citados, exponen que han acordado y convenido en celebrar el siguiente <b>Contrato Civil de Prestación de Servicios a Honorarios</b>, sujeto estrictamente a las siguientes cláusulas y condiciones:
  </p>

  <p>
    <b>PRIMERO: ANTECEDENTES Y OBJETO DEL CONTRATO.</b><br>
    El Mandante es una empresa que brinda soluciones operativas de logística, almacenamiento, preparación y despacho de paquetería de última milla a través de diversas modalidades para el comercio electrónico y retail. A fin de absorber contingencias operativas, fluctuaciones de demanda y temporadas de alto flujo comercial, El Mandante requiere contratar la prestación de servicios independientes y profesionales de conducción y distribución.<br>
    Por su parte, El Prestador de Servicios declara contar con las competencias técnicas, licencia de conducir vigente y conocimientos viales para ejecutar en forma autónoma e independiente los encargos encomendados, obligándose por este acto a prestar servicios de retiro, traslado, transporte y entrega física de paquetería y bultos hacia destinos finales (domicilios particulares y centros logísticos de distribución).
  </p>

  <p>
    <b>SEGUNDO: NATURALEZA CIVIL, CARÁCTER ESPORÁDICO Y AUTONOMÍA OPERATIVA.</b><br>
    Las partes dejan formal y expresa constancia de que la presente relación contractual se regirá bajo los siguientes principios fundamentales:
  </p>
  <ul>
    <li><b>Régimen por Llamados Esporádicos a Demanda:</b> La prestación de servicios se desarrollará exclusivamente en base a requerimientos y llamados puntuales, transitorios y esporádicos formulados por El Mandante cuando las necesidades operacionales así lo demanden. El presente contrato no asegura una frecuencia mínima, periodicidad continua ni volumen fijo mensual de servicios.</li>
    <li><b>Plena Libertad de Aceptación:</b> El Prestador de Servicios goza de absoluta y total libertad para aceptar o declinar libremente cada convocatoria o solicitud de servicio que El Mandante le comunique, de acuerdo a su propia conveniencia y disponibilidad personal, sin que el rechazo constituya infracción, causal de término ni genere sanción económica o disciplinaria alguna.</li>
    <li><b>Autonomía de Tiempos y Ausencia de Jornada Rígida:</b> El Prestador no se encuentra sujeto a jornada legal de trabajo ordinaria ni al cumplimiento de horarios predeterminados de entrada y salida propios de una relación laboral. El Prestador organizará autónomamente sus tiempos de conducción, descansos y el orden de su ruta de reparto, con el único compromiso de cumplir con los plazos comerciales convenidos para cada servicio (por ejemplo, ventanas de entrega Same Day o entregas dentro del día de despacho).</li>
    <li><b>Inexistencia de Exclusividad:</b> El Prestador mantiene plena libertad para prestar servicios idénticos, similares o de cualquier otra índole a favor de terceras personas naturales o empresas, sin restricción alguna de concurrencia, con la sola limitación de resguardar la debida reserva de la información y dar oportuno cumplimiento a los encargos específicos que haya aceptado.</li>
  </ul>

  <p>
    <b>TERCERO: ESTÁNDAR OPERATIVO DE LOS SERVICIOS Y VALIDACIÓN DE ENTREGAS.</b><br>
    En cada llamado o encargo que El Prestador acepte ejecutar, se compromete a realizar las siguientes labores con el debido cuidado y diligencia:
  </p>
  <ul>
    <li>Retirar oportunamente la paquetería asignada desde las bodegas o centros de distribución que El Mandante le indique para el respectivo despacho.</li>
    <li>Verificar el inventario físico de paquetes asignados antes de iniciar la ruta, contrastándolo con el manifiesto digital.</li>
    <li>Transportar de forma segura la carga hacia los domicilios de clientes finales o centros logísticos (tales como bodegas de Mercado Libre, Falabella, Bluexpress, Starken, Chilexpress u otros operadores logísticos).</li>
    <li><b>Acreditación Digital Obligatoria de la Entrega:</b> Para considerar un paquete válidamente entregado y generador de honorarios, El Prestador deberá registrar y respaldar en el aplicativo móvil proporcionado por El Mandante la siguiente evidencia:
      <ol type="a">
        <li>Fotografía nítida y legible de la numeración visible del inmueble o domicilio de entrega.</li>
        <li>Fotografía de la entrega material del paquete al receptor.</li>
        <li>Registro fidedigno del nombre completo y número de cédula de identidad (RUT) de la persona que recepciona el paquete.</li>
      </ol>
    </li>
    <li>Realizar hasta dos (2) intentos de entrega en caso de no ubicar al receptor en el primer intento, agotando las gestiones de contacto telefónico registradas.</li>
    <li>Rendir y devolver a bodega al término de la ruta del día todos aquellos bultos cuya entrega no haya podido concretarse por causales justificadas.</li>
  </ul>

  <p>
    <b>CUARTO: HONORARIOS, TARIFA POR RESULTADO Y FECHA DE PAGO.</b><br>
    Las partes convienen la retribución económica de los servicios prestados de acuerdo a las siguientes condiciones:
  </p>
  <ul>
    <li><b>Tarifa Unitaria por Paquete Efectivamente Entregado:</b> El Mandante pagará a El Prestador la suma de <b>$1.100.- (mil cien pesos chilenos)</b> por cada paquete entregado exitosamente en destino y que cuente con la correspondiente acreditación fotográfica y de datos del receptor en el aplicativo móvil.</li>
    <li><b>Exclusión de Paquetes No Entregados:</b> Aquellos bultos que no fueren entregados, que fueren devueltos a bodega por desistimiento del cliente o que carezcan del respaldo fotográfico requerido no devengarán honorarios, sin perjuicio de devengarlos en caso de que sean reprogramados y entregados con éxito en una posterior gestión.</li>
    <li><b>Boleta de Honorarios Electrónica:</b> Como requisito indispensable para proceder al pago, El Prestador de Servicios deberá emitir a través del sitio web del Servicio de Impuestos Internos (SII) su <b>Boleta de Honorarios Electrónica</b> emitida a nombre de <b>STK SOLUTIONS LOGISTICA Y SERVICIOS SPA (RUT 78.519.038-6)</b>, por el monto total de las entregas conformes del mes calendario. Dicha boleta deberá ser emitida a más tardar el día 2 del mes calendario siguiente a aquel en que se efectuaron las entregas.</li>
    <li><b>Fecha de Pago:</b> El pago de los honorarios se efectuará los días <b>5 de cada mes calendario</b> (o el día hábil bancario inmediatamente posterior si el día 5 fuere sábado, domingo o festivo), liquidando la totalidad de los servicios prestados en el mes calendario inmediatamente anterior.</li>
    <li><b>Retenciones Tributarias Legales:</b> De conformidad con lo establecido en el artículo 74 Nº 2 de la Ley sobre Impuesto a la Renta y la Ley Nº 21.133, El Mandante retendrá del valor bruto de la boleta de honorarios el porcentaje legal de impuestos correspondiente al año comercial en curso (retención obligatoria para trabajadores independientes), enterándolo oportunamente ante el Fisco de Chile mediante el Formulario 29. El pago de cotizaciones previsionales de salud y pensiones será de cargo del Prestador a través de la Operación Renta anual ante el SII.</li>
  </ul>

  <p>
    <b>QUINTO: AUTORIZACIÓN EXPRESA DE TRANSFERENCIA BANCARIA Y DATOS DE PAGO.</b><br>
    El Prestador de Servicios autoriza e instruye formal y expresamente a STK SOLUTIONS LOGISTICA Y SERVICIOS SPA para que la totalidad de los honorarios líquidos devengados le sean pagados mediante transferencia electrónica bancaria a la cuenta de su exclusiva titularidad que se individualiza a continuación:
  </p>

  <table>
    <tr>
      <td><b>Nombre del Titular:</b></td>
      <td><b>EMMANUEL SEBASTIÁN MAULÉN SANDOVAL</b></td>
    </tr>
    <tr>
      <td><b>RUT del Titular:</b></td>
      <td><b>16.411.808-8</b></td>
    </tr>
    <tr>
      <td><b>Banco o Institución Financiera:</b></td>
      <td>[ ____________________________________________________________________ ]</td>
    </tr>
    <tr>
      <td><b>Tipo de Cuenta (Corriente / Vista / CuentaRUT):</b></td>
      <td>[ ____________________________________________________________________ ]</td>
    </tr>
    <tr>
      <td><b>Número de Cuenta Bancaria:</b></td>
      <td>[ ____________________________________________________________________ ]</td>
    </tr>
    <tr>
      <td><b>Correo Electrónico para Comprobante:</b></td>
      <td>[ ____________________________________________________________________ ]</td>
    </tr>
  </table>

  <p>
    El comprobante emitido por la institución bancaria originadora de la transferencia constituirá recibo pleno, válido y suficiente de pago de los honorarios del período correspondiente. El Prestador asume la obligación de notificar formalmente cualquier modificación a sus datos de transferencia con al menos cinco (5) días hábiles de anticipación a la fecha de pago.
  </p>

  <p>
    <b>SEXTO: ASIGNACIÓN DE VEHÍCULO Y EQUIPO CELULAR EN COMODATO DE USO PRECARIO.</b><br>
    A fin de hacer posible la realización material de los encargos de entrega que acepte realizar, El Mandante proporciona a El Prestador, quien los recibe a su entera conformidad y en calidad exclusiva de <b>Comodato de Uso Precario</b> (artículos 2174 y siguientes del Código Civil), los siguientes bienes de dominio o legítima tenencia de la Empresa:
  </p>
  <ul>
    <li><b>Vehículo Motorizado:</b> Furgón o vehículo de reparto, <b>Placa Patente Única (PPU) SVVP-43</b>, con toda su documentación vial al día (Padrón, Permiso de Circulación, Seguro SOAP y Certificado de Revisión Técnica y Gases vigente).</li>
    <li><b>Dispositivo Móvil (Smartphone):</b> Teléfono celular corporativo con cargador, cable de datos y chip con plan de internet activo, el cual cuenta con la aplicación de logística instalada.</li>
  </ul>
  <p>
    La entrega y tenencia de los citados bienes se rige por las siguientes obligaciones y prohibiciones expresas:
  </p>
  <ul>
    <li><b>Destino Exclusivo al Servicio:</b> El vehículo y el dispositivo celular quedan asignados exclusivamente a la ejecución de las faenas logísticas y de reparto encomendadas por El Mandante. Se prohíbe de manera absoluta su uso con fines personales, familiares, recreacionales, comerciales ajenos o para transporte de pasajeros no autorizados.</li>
    <li><b>Prohibición Terminante de Transportar Terceros:</b> El Prestador se compromete a no transportar en el vehículo PPU SVVP-43 a terceras personas, familiares, amigos, acompañantes o personas ajenas a la operación logística de El Mandante.</li>
    <li><b>Prohibición de Traspaso:</b> El Prestador no podrá ceder, prestar ni permitir la conducción del vehículo ni la custodia del teléfono a terceras personas bajo ningún pretexto, revistiendo la conducción carácter personalísimo.</li>
    <li><b>Deber de Cuidado y Diligencia:</b> El Prestador se obliga a cuidar y conservar los bienes con el estándar de diligencia de un buen padre de familia (responsabilidad por culpa leve). Deberá verificar periódicamente el nivel de aceite, refrigerante, líquido de frenos, presión de neumáticos y estado de luces.</li>
    <li><b>Restitución Inmediata:</b> El Prestador se obliga a restituir de inmediato el vehículo PPU SVVP-43 y el equipo celular en las mismas condiciones operativas en que fueron recibidos (salvo el desgaste propio del uso legítimo), en el lugar de estacionamiento o depósito habitual de El Mandante, al término de cada jornada de servicio o en cualquier momento en que El Mandante lo solicite, sin derecho de retención de ninguna clase.</li>
  </ul>

  <p>
    <b>SÉPTIMO: CUMPLIMIENTO DE LA LEY DE TRÁNSITO, RESPONSABILIDAD POR MULTAS Y SINIESTROS.</b><br>
    Respecto a la operación y conducción del vehículo motorizado, se estipula lo siguiente:
  </p>
  <ul>
    <li><b>Licencia de Conducir Habilitante:</b> El Prestador declara bajo juramento estar en posesión de Licencia de Conducir chilena vigente y legalmente apta para el vehículo asignado, obligándose a portarla en todo momento y a comunicar de inmediato cualquier infracción, retención, suspensión o inhabilidad que afecte su licencia.</li>
    <li><b>Responsabilidad Exclusiva por Multas e Infracciones de Tránsito:</b> El Prestador asume íntegra y exclusiva responsabilidad civil, pecuniaria y administrativa por cualquier infracción a la Ley de Tránsito (Ley Nº 18.290), ordenanzas municipales o reglamentos de transporte que se curse al vehículo PPU SVVP-43 durante los lapsos en que se encuentre bajo su conducción o tenencia. Lo anterior comprende:
      <ol type="a">
        <li>Infracciones cursadas por Carabineros de Chile o inspectores fiscales y municipales (exceso de velocidad, no respetar semáforos o señales de detención, virajes prohibidos, conducción distraída con aparatos electrónicos, etc.).</li>
        <li>Partes por uso indebido de vías exclusivas (pistas Solo Bus / corredores del sistema metropolitano de transporte).</li>
        <li>Multas por mal estacionamiento o estacionamiento en lugares prohibidos.</li>
        <li>Multas de empadronamiento aplicadas al vehículo durante las rutas asignadas.</li>
        <li>Cobros, peajes y multas derivados del tránsito en autopistas concesionadas sin dispositivo TAG habilitado o en infracción a la Ley de Concesiones.</li>
      </ol>
      En caso de que El Mandante sea notificado o deba cancelar cualquiera de estas multas para renovar permisos viales o alzar anotaciones, El Prestador autoriza desde ya a El Mandante a descontar su valor íntegro de los honorarios que se encuentren pendientes de pago, o se compromete a restituir el monto desembolsado en un plazo fatal de 48 horas tras ser notificado.
    </li>
    <li><b>Siniestros, Accidentes y Colisiones:</b> Ante cualquier siniestro, colisión, choque, hurto o accidente:
      <ol type="a">
        <li>El Prestador deberá dar aviso inmediato a Carabineros de Chile (dejando la respectiva constancia o denuncia policial) y notificar formalmente a El Mandante en un plazo máximo de dos (2) horas.</li>
        <li>Deberá comparecer y colaborar activamente en la declaración jurada ante la compañía aseguradora del vehículo.</li>
        <li>Si el siniestro ocurriere por culpa grave, negligencia inexcusable, conducción bajo los efectos del alcohol o sustancias psicotrópicas, o infracción manifiesta a las normas del tránsito, El Prestador responderá directa y personalmente de la totalidad de los perjuicios ocasionados al vehículo, a la carga y a terceros, incluyendo el costo del deducible de la póliza de seguros si procediere.</li>
      </ol>
    </li>
  </ul>

  <p>
    <b>OCTAVO: NATURALEZA JURÍDICA Y RESGUARDO ANTE LA DIRECCIÓN DEL TRABAJO.</b><br>
    Las partes declaran de forma libre, expresa e informada que el presente acuerdo es de índole estrictamente <b>civil y comercial</b>, regulándose por las normas sobre arrendamiento de servicios inmateriales contenidas en los artículos 2006 y siguientes del Código Civil, no resultando aplicables las disposiciones del Código del Trabajo.<br>
    En virtud de lo anterior, las partes dejan expresamente establecido que:
  </p>
  <ul>
    <li>Entre El Mandante y El Prestador <b>no existe vínculo de subordinación ni de dependencia jurídica</b> en los términos regulados por los artículos 7º y 8º del Código del Trabajo.</li>
    <li>El Mandante no posee facultades de mando jerárquico disciplinario, ni potestad amonestatoria laboral sobre El Prestador, limitándose las relaciones a la coordinación técnica y verificación del resultado material de las entregas.</li>
    <li>El Prestador no tiene jornada laboral fija ni horario diario predeterminado, ejerciendo su cometido de forma autónoma según las solicitudes esporádicas que decida aceptar.</li>
    <li>Por consiguiente, El Prestador no devengará derechos o beneficios laborales propios de los trabajadores dependientes, tales como sueldo base asegurado, remuneración de horas extraordinarias, feriado anual con goce de remuneraciones, gratificación legal, licencias médicas a cargo de la empresa ni indemnizaciones por años de servicio o aviso previo. Las partes reconocen que esta estipulación responde a la realidad material y efectiva de sus relaciones comerciales y operativas (principio de primacía de la realidad).</li>
  </ul>

  <p>
    <b>NOVENO: CUSTODIA Y RESPONSABILIDAD DE LA PAQUETERÍA.</b><br>
    El Prestador asume la obligación de custodiar con la máxima diligencia las encomiendas y paquetes recibidos, respondiendo económicamente por cualquier pérdida, extravío, rotura culpable o sustracción de bultos ocurrida mientras se encuentren bajo su tenencia, autorizando expresamente a El Mandante a descontar su costo comercial debidamente acreditado de las liquidaciones de honorarios devengados.
  </p>

  <p>
    <b>DÉCIMO: CONFIDENCIALIDAD Y PROTECCIÓN DE DATOS PERSONALES.</b><br>
    De conformidad con la Ley Nº 19.628 sobre Protección de la Vida Privada, El Prestador se obliga a guardar estricta reserva respecto de la información personal de los destinatarios a los que tenga acceso con motivo de las entregas (nombres, direcciones, números telefónicos y contenidos de los despachos). Queda estrictamente prohibido divulgar, duplicar, almacenar o utilizar tales datos para fines particulares o comerciales ajenos a la entrega encomendada.
  </p>

  <p>
    <b>UNDÉCIMO: VIGENCIA Y TÉRMINO DEL CONTRATO.</b><br>
    El presente contrato comenzará a regir a contar de la fecha de su suscripción y tendrá una vigencia indefinida como marco de los sucesivos requerimientos esporádicos.<br>
    Cualquiera de las partes podrá poner término anticipado al contrato en cualquier momento, sin expresión de causa ni derecho a indemnización, notificándolo a la otra parte por escrito o correo electrónico con al menos 48 horas de anticipación.<br>
    Asimismo, El Mandante podrá poner término inmediato al contrato, sin necesidad de aviso previo, en los siguientes casos:
  </p>
  <ul>
    <li>Suspensión, caducidad o retención de la licencia de conducir de El Prestador.</li>
    <li>Uso no autorizado del vehículo o teléfono corporativo para fines personales, o transporte de terceros no autorizados.</li>
    <li>Reiteración en faltas graves o gravísimas a la Ley de Tránsito.</li>
    <li>Apropiación, pérdida culpable o adulteración en los respaldos de entrega de paquetería.</li>
    <li>Negativa a restituir los bienes facilitados en comodato cuando sean requeridos.</li>
  </ul>

  <p>
    <b>DUODÉCIMO: DOMICILIO Y JURISDICCIÓN.</b><br>
    Para todos los efectos legales derivados del presente contrato, las partes fijan domicilio convencional en la comuna y ciudad de Santiago de Chile, sometiéndose expresamente a la competencia de sus Tribunales Ordinarios de Justicia.
  </p>

  <p>
    <b>DECIMOTERCERO: EJEMPLARES.</b><br>
    El presente contrato se firma en dos ejemplares de idéntico tenor y fecha, quedando uno en poder de cada parte.
  </p>

  <table class="signature-table">
    <tr>
      <td>
        __________________________________________<br>
        <b>FRANCISCO ESTEBAN TRUJILLO PEREZ</b><br>
        C.I. Nº 19.622.297-9<br>
        En representación legal de<br>
        <b>STK SOLUTIONS LOGISTICA Y SERVICIOS SPA</b><br>
        RUT: 78.519.038-6<br>
        <i>"El Mandante"</i>
      </td>
      <td>
        __________________________________________<br>
        <b>EMMANUEL SEBASTIÁN MAULÉN SANDOVAL</b><br>
        C.I. Nº 16.411.808-8<br>
        Huerta Florida Nº 1214, La Florida<br>
        <br>
        <i>"El Prestador de Servicios"</i>
      </td>
    </tr>
  </table>

  <br><br>
  <hr>
  <br>

  <h1>ANEXO Nº 1: ACTA DE ENTREGA, INVENTARIO Y RECEPCIÓN DE VEHÍCULO Y EQUIPO CELULAR</h1>
  <h2>STK SOLUTIONS LOGISTICA Y SERVICIOS SPA</h2>

  <p>
    En la ciudad de Santiago de Chile, a [ .......... ] de [ ..................................... ] de 202[ ... ], se procede a la entrega material de los implementos individualizados en el Contrato Civil de Prestación de Servicios a Honorarios celebrado entre <b>STK SOLUTIONS LOGISTICA Y SERVICIOS SPA</b> y don <b>EMMANUEL SEBASTIÁN MAULÉN SANDOVAL</b>:
  </p>

  <h3>1. INDIVIDUALIZACIÓN DEL VEHÍCULO ASIGNADO EN COMODATO</h3>
  <table>
    <tr>
      <td><b>Placa Patente Única (PPU):</b></td>
      <td><b>SVVP-43</b></td>
      <td><b>Kilometraje al Momento de Entrega:</b></td>
      <td>[ ______________________ ] km</td>
    </tr>
    <tr>
      <td><b>Marca y Modelo:</b></td>
      <td>[ ___________________________ ]</td>
      <td><b>Nivel de Combustible:</b></td>
      <td>[ ] 1/4 &nbsp;&nbsp; [ ] 1/2 &nbsp;&nbsp; [ ] 3/4 &nbsp;&nbsp; [ ] Lleno</td>
    </tr>
    <tr>
      <td><b>Año de Fabricación:</b></td>
      <td>[ ___________________________ ]</td>
      <td><b>Color del Vehículo:</b></td>
      <td>[ ___________________________ ]</td>
    </tr>
  </table>

  <h3>2. INVENTARIO DE DOCUMENTACIÓN DEL VEHÍCULO</h3>
  <table>
    <tr>
      <th>Documentación Legal Obligatoria</th>
      <th>Estado de Entrega</th>
    </tr>
    <tr>
      <td>Certificado de Inscripción y Anotaciones Vigentes (Padrón del vehículo)</td>
      <td>[ &nbsp; ] Conforme original/copia &nbsp;&nbsp; [ &nbsp; ] No entregado</td>
    </tr>
    <tr>
      <td>Permiso de Circulación vigente</td>
      <td>[ &nbsp; ] Conforme original/copia &nbsp;&nbsp; [ &nbsp; ] No entregado</td>
    </tr>
    <tr>
      <td>Seguro Obligatorio de Accidentes Personales (SOAP) vigente</td>
      <td>[ &nbsp; ] Conforme original/copia &nbsp;&nbsp; [ &nbsp; ] No entregado</td>
    </tr>
    <tr>
      <td>Certificado de Revisión Técnica y de Gases vigente</td>
      <td>[ &nbsp; ] Conforme original/copia &nbsp;&nbsp; [ &nbsp; ] No entregado</td>
    </tr>
    <tr>
      <td>Dispositivo TAG instalado y operativo en parabrisas</td>
      <td>[ &nbsp; ] Conforme instalado &nbsp;&nbsp; [ &nbsp; ] Sin dispositivo</td>
    </tr>
  </table>

  <h3>3. EQUIPAMIENTO Y ELEMENTOS DE SEGURIDAD VIAL OBLIGATORIOS</h3>
  <table>
    <tr>
      <th>Elemento de Seguridad Vial</th>
      <th>Estado</th>
    </tr>
    <tr>
      <td>Rueda de repuesto operativa</td>
      <td>[ &nbsp; ] Sí &nbsp;&nbsp; [ &nbsp; ] No</td>
    </tr>
    <tr>
      <td>Gata mecánica y llave de rueda</td>
      <td>[ &nbsp; ] Sí &nbsp;&nbsp; [ &nbsp; ] No</td>
    </tr>
    <tr>
      <td>Triángulos de seguridad reflectantes (2 unidades)</td>
      <td>[ &nbsp; ] Sí &nbsp;&nbsp; [ &nbsp; ] No</td>
    </tr>
    <tr>
      <td>Chaleco reflectante de alta visibilidad</td>
      <td>[ &nbsp; ] Sí &nbsp;&nbsp; [ &nbsp; ] No</td>
    </tr>
    <tr>
      <td>Extintor de incendios con carga y manómetro vigente</td>
      <td>[ &nbsp; ] Sí &nbsp;&nbsp; [ &nbsp; ] No</td>
    </tr>
    <tr>
      <td>Botiquín reglamentario de primeros auxilios</td>
      <td>[ &nbsp; ] Sí &nbsp;&nbsp; [ &nbsp; ] No</td>
    </tr>
  </table>

  <h3>4. INDIVIDUALIZACIÓN DEL EQUIPO MÓVIL CORPORATIVO</h3>
  <table>
    <tr>
      <td><b>Marca y Modelo del Celular:</b></td>
      <td>[ ____________________________________________________________________ ]</td>
    </tr>
    <tr>
      <td><b>Código IMEI:</b></td>
      <td>[ ____________________________________________________________________ ]</td>
    </tr>
    <tr>
      <td><b>Número Telefónico SIM Card:</b></td>
      <td>[ ____________________________________________________________________ ]</td>
    </tr>
    <tr>
      <td><b>Accesorios Entregados:</b></td>
      <td>[ &nbsp; ] Cargador de pared &nbsp;&nbsp; [ &nbsp; ] Cable USB &nbsp;&nbsp; [ &nbsp; ] Soporte para auto</td>
    </tr>
    <tr>
      <td><b>Estado de Pantalla y Carcasa:</b></td>
      <td>[ &nbsp; ] En óptimo estado y sin fisuras &nbsp;&nbsp; [ &nbsp; ] Con detalles</td>
    </tr>
  </table>

  <h3>5. OBSERVACIONES Y DETALLE DE DETALLES PREVIOS EN CARROCERÍA / MECÁNICA:</h3>
  <p>
    [Detallar si existen rayones, abolladuras, desgaste de neumáticos o comentarios al momento de la entrega]:<br>
    ____________________________________________________________________________________________________________________<br>
    ____________________________________________________________________________________________________________________
  </p>

  <p>
    Don <b>EMMANUEL SEBASTIÁN MAULÉN SANDOVAL</b> declara haber recibido a su entera conformidad y satisfacción el vehículo PPU <b>SVVP-43</b> y el teléfono celular antes descritos, limpios, con sus documentos en regla y en condiciones óptimas para el cumplimiento de los servicios independientes acordados, asumiendo su custodia y el compromiso formal de restituirlos en iguales condiciones.
  </p>

  <table class="signature-table">
    <tr>
      <td>
        __________________________________________<br>
        <b>ENTREGA CONFORME</b><br>
        Por <b>STK SOLUTIONS LOGISTICA Y SERVICIOS SPA</b><br>
        RUT: 78.519.038-6
      </td>
      <td>
        __________________________________________<br>
        <b>RECIBE CONFORME</b><br>
        <b>EMMANUEL SEBASTIÁN MAULÉN SANDOVAL</b><br>
        C.I. Nº 16.411.808-8
      </td>
    </tr>
  </table>

</body>
</html>
`;

async function generate() {
  try {
    const docxBuffer = await HTMLtoDOCX(htmlContent, null, {
      table: { row: { cantSplit: true } },
      footer: true,
      pageNumber: true
    });

    const docxPath = path.join(__dirname, '..', 'CONTRATO_HONORARIOS_CONDUCTOR_EMMANUEL_MAULEN.docx');
    fs.writeFileSync(docxPath, docxBuffer);
    console.log('DOCX generado exitosamente:', docxPath, 'Tamaño:', docxBuffer.length);
  } catch (err) {
    console.error('Error generando DOCX:', err);
    process.exit(1);
  }
}

generate();
